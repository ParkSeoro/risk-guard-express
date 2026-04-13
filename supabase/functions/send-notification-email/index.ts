import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface NotificationPayload {
  notification_id?: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  related_id?: string;
  related_type?: string;
  project_id?: string;
}

async function sendEmailViaResend(to: string, subject: string, body: string, apiKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') || '안전관리시스템 <onboarding@resend.dev>',
        to: [to],
        subject,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
          <h2 style="color:#1a1a2e;border-bottom:2px solid #e94560;padding-bottom:8px;">${subject}</h2>
          <p style="color:#333;line-height:1.6;">${body.replace(/\n/g, '<br/>')}</p>
          <hr style="margin-top:24px;border:none;border-top:1px solid #eee;"/>
          <p style="color:#999;font-size:12px;">안전관리시스템 자동 발송</p>
        </div>`,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `Resend API ${res.status}: ${err}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const payload: NotificationPayload = await req.json();
    const { user_id, title, message, type, related_id, related_type, project_id } = payload;

    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: 'user_id and title are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Create in-app notification
    const { data: notification, error: notifError } = await supabase
      .from('notifications')
      .insert([{ user_id, title, message: message || '', type: type || 'approval', related_id, related_type, project_id }])
      .select()
      .single();

    if (notifError) {
      console.error('Notification insert error:', notifError);
      return new Response(JSON.stringify({ error: notifError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Check user's notification preferences
    const { data: prefs } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user_id)
      .maybeSingle();

    const emailEnabled = prefs?.channel_email !== false;
    let eventEnabled = true;
    if (prefs) {
      if (type === 'approval_request' || type === 'approval') eventEnabled = prefs.event_approval_request !== false;
      else if (type === 'approval_approved' || type === 'approval_rejected') eventEnabled = prefs.event_approval_result !== false;
      else if (type === 'return_request') eventEnabled = prefs.event_return_request !== false;
      else if (type === 'validation_complete') eventEnabled = prefs.event_validation_complete !== false;
    }

    // Business hours check
    if (prefs?.business_hours_only) {
      const now = new Date();
      const kstHour = (now.getUTCHours() + 9) % 24;
      const kstDay = now.getUTCDay();
      if (kstDay === 0 || kstDay === 6 || kstHour < 9 || kstHour >= 18) {
        return new Response(JSON.stringify({ 
          success: true, notification_id: notification.id,
          email_sent: false, reason: 'outside_business_hours'
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    if (!emailEnabled || !eventEnabled) {
      return new Response(JSON.stringify({ 
        success: true, notification_id: notification.id,
        email_sent: false, reason: 'user_preference_disabled'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Get user email
    const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(user_id);
    
    if (authError || !authUser?.email) {
      console.error('User email lookup error:', authError);
      return new Response(JSON.stringify({ 
        success: true, notification_id: notification.id,
        email_sent: false, reason: 'no_email'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 4. Attempt email sending via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY');
    let emailSent = false;
    let emailError = '';
    const subject = `[위험성평가] ${title}`;

    if (resendKey) {
      const result = await sendEmailViaResend(authUser.email, subject, message || title, resendKey);
      emailSent = result.success;
      emailError = result.error || '';
    } else {
      emailError = 'RESEND_API_KEY not configured';
    }

    // 5. Log email attempt to audit_logs
    await supabase.from('audit_logs').insert([{
      action: emailSent ? 'email_notification_sent' : 'email_notification_failed',
      target_type: 'notification',
      target_id: notification.id,
      user_id: user_id,
      user_name: authUser.email,
      project_id: project_id || null,
      details: {
        to: authUser.email,
        subject,
        type,
        email_sent: emailSent,
        error: emailError || null,
      },
    }]);

    return new Response(JSON.stringify({ 
      success: true, 
      notification_id: notification.id,
      email_sent: emailSent,
      to: authUser.email,
      error: emailError || undefined,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('send-notification-email error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
