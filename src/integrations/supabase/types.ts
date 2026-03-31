export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ai_risk_cache: {
        Row: {
          cache_key: string
          created_at: string
          created_by: string | null
          equipment: string | null
          generated_items: Json
          hit_count: number | null
          id: string
          process_name: string
          updated_at: string
          work_description: string | null
          work_environment: string[] | null
          work_location: string | null
        }
        Insert: {
          cache_key: string
          created_at?: string
          created_by?: string | null
          equipment?: string | null
          generated_items?: Json
          hit_count?: number | null
          id?: string
          process_name: string
          updated_at?: string
          work_description?: string | null
          work_environment?: string[] | null
          work_location?: string | null
        }
        Update: {
          cache_key?: string
          created_at?: string
          created_by?: string | null
          equipment?: string | null
          generated_items?: Json
          hit_count?: number | null
          id?: string
          process_name?: string
          updated_at?: string
          work_description?: string | null
          work_environment?: string[] | null
          work_location?: string | null
        }
        Relationships: []
      }
      approval_lines: {
        Row: {
          company_id: string | null
          company_name: string | null
          created_at: string
          id: string
          position: string
          project_id: string
          step_label: string
          step_order: number
          updated_at: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          position?: string
          project_id: string
          step_label?: string
          step_order?: number
          updated_at?: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          position?: string
          project_id?: string
          step_label?: string
          step_order?: number
          updated_at?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_route_templates: {
        Row: {
          assessment_type: string
          created_at: string
          created_by: string | null
          id: string
          is_default: boolean
          name: string
          project_id: string
          steps: Json
          updated_at: string
        }
        Insert: {
          assessment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          project_id: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          assessment_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_default?: boolean
          name?: string
          project_id?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_route_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      approvals: {
        Row: {
          approval_version: number | null
          approved_at: string | null
          approver_id: string | null
          approver_name: string | null
          comment: string | null
          company_id: string | null
          company_name: string | null
          created_at: string
          id: string
          position: string | null
          project_id: string
          risk_item_id: string | null
          run_id: string | null
          status: string
          step: string
          updated_at: string
          version: number | null
        }
        Insert: {
          approval_version?: number | null
          approved_at?: string | null
          approver_id?: string | null
          approver_name?: string | null
          comment?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          position?: string | null
          project_id: string
          risk_item_id?: string | null
          run_id?: string | null
          status?: string
          step: string
          updated_at?: string
          version?: number | null
        }
        Update: {
          approval_version?: number | null
          approved_at?: string | null
          approver_id?: string | null
          approver_name?: string | null
          comment?: string | null
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          id?: string
          position?: string | null
          project_id?: string
          risk_item_id?: string | null
          run_id?: string | null
          status?: string
          step?: string
          updated_at?: string
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_risk_item_id_fkey"
            columns: ["risk_item_id"]
            isOneToOne: false
            referencedRelation: "risk_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "assessment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_run_participants: {
        Row: {
          company: string | null
          created_at: string
          id: string
          role: string
          run_id: string
          signed_at: string | null
          user_name: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          id?: string
          role?: string
          run_id: string
          signed_at?: string | null
          user_name?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          id?: string
          role?: string
          run_id?: string
          signed_at?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_run_participants_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "assessment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_runs: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          end_date: string | null
          id: string
          is_deleted: boolean
          notes: string | null
          period_label: string
          project_id: string
          start_date: string | null
          status: string
          target_company_ids: string[] | null
          target_contractors: string[] | null
          target_processes: string[] | null
          type: string
          updated_at: string
          validation_score: number | null
          validation_verdict: string | null
          worker_participation_images: string[] | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          end_date?: string | null
          id?: string
          is_deleted?: boolean
          notes?: string | null
          period_label?: string
          project_id: string
          start_date?: string | null
          status?: string
          target_company_ids?: string[] | null
          target_contractors?: string[] | null
          target_processes?: string[] | null
          type?: string
          updated_at?: string
          validation_score?: number | null
          validation_verdict?: string | null
          worker_participation_images?: string[] | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          end_date?: string | null
          id?: string
          is_deleted?: boolean
          notes?: string | null
          period_label?: string
          project_id?: string
          start_date?: string | null
          status?: string
          target_company_ids?: string[] | null
          target_contractors?: string[] | null
          target_processes?: string[] | null
          type?: string
          updated_at?: string
          validation_score?: number | null
          validation_verdict?: string | null
          worker_participation_images?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          id: string
          project_id: string | null
          target_id: string | null
          target_type: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          id?: string
          project_id?: string | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          id?: string
          project_id?: string | null
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          content: string
          created_at: string | null
          id: string
          mentions: string[] | null
          project_id: string
          risk_item_id: string | null
          updated_at: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          mentions?: string[] | null
          project_id: string
          risk_item_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          mentions?: string[] | null
          project_id?: string
          risk_item_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_risk_item_id_fkey"
            columns: ["risk_item_id"]
            isOneToOne: false
            referencedRelation: "risk_items"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          address: string | null
          business_no: string | null
          contact: string | null
          created_at: string
          id: string
          name: string
          parent_company_id: string | null
          period: string | null
          project_id: string
          scope: string | null
          type: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          business_no?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name: string
          parent_company_id?: string | null
          period?: string | null
          project_id: string
          scope?: string | null
          type?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          business_no?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name?: string
          parent_company_id?: string | null
          period?: string | null
          project_id?: string
          scope?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      company_construction_info: {
        Row: {
          company_id: string
          construction_amount: number | null
          construction_name: string
          construction_period_end: string | null
          construction_period_start: string | null
          construction_type: string
          created_at: string
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          company_id: string
          construction_amount?: number | null
          construction_name?: string
          construction_period_end?: string | null
          construction_period_start?: string | null
          construction_type?: string
          created_at?: string
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          construction_amount?: number | null
          construction_name?: string
          construction_period_end?: string | null
          construction_period_start?: string | null
          construction_type?: string
          created_at?: string
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_construction_info_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_construction_info_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          role_in_company: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role_in_company?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role_in_company?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      department_assignees: {
        Row: {
          backup_user_id: string | null
          created_at: string
          default_user_id: string | null
          department_id: string
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          backup_user_id?: string | null
          created_at?: string
          default_user_id?: string | null
          department_id: string
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          backup_user_id?: string | null
          created_at?: string
          default_user_id?: string | null
          department_id?: string
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "department_assignees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_assignees_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      dismissed_recommendations: {
        Row: {
          created_at: string
          dismissed_by: string | null
          gap_key: string
          id: string
          project_id: string
          run_id: string | null
        }
        Insert: {
          created_at?: string
          dismissed_by?: string | null
          gap_key: string
          id?: string
          project_id: string
          run_id?: string | null
        }
        Update: {
          created_at?: string
          dismissed_by?: string | null
          gap_key?: string
          id?: string
          project_id?: string
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_recommendations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dismissed_recommendations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "assessment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      environment_tags: {
        Row: {
          category: string
          created_at: string
          id: string
          is_default: boolean | null
          name: string
          project_id: string | null
          sort_order: number | null
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          is_default?: boolean | null
          name: string
          project_id?: string | null
          sort_order?: number | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_default?: boolean | null
          name?: string
          project_id?: string | null
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "environment_tags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_batches: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          options: Json | null
          project_id: string
          risk_distribution: Json | null
          source_id: string | null
          source_type: string
          total_items: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          options?: Json | null
          project_id: string
          risk_distribution?: Json | null
          source_id?: string | null
          source_type: string
          total_items?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          options?: Json | null
          project_id?: string
          risk_distribution?: Json | null
          source_id?: string | null
          source_type?: string
          total_items?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_duties: {
        Row: {
          company_id: string | null
          created_at: string
          description: string | null
          duty_category: string
          duty_name: string
          frequency: string
          id: string
          is_active: boolean
          legal_basis: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          description?: string | null
          duty_category?: string
          duty_name: string
          frequency?: string
          id?: string
          is_active?: boolean
          legal_basis?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          description?: string | null
          duty_category?: string
          duty_name?: string
          frequency?: string
          id?: string
          is_active?: boolean
          legal_basis?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_duties_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_duties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_references: {
        Row: {
          article: string
          created_at: string
          description: string | null
          id: string
          keywords: string[] | null
          law_name: string
          link: string | null
          needs_review: boolean | null
          process_mappings: string[] | null
          revision_date: string | null
          updated_at: string
        }
        Insert: {
          article: string
          created_at?: string
          description?: string | null
          id?: string
          keywords?: string[] | null
          law_name: string
          link?: string | null
          needs_review?: boolean | null
          process_mappings?: string[] | null
          revision_date?: string | null
          updated_at?: string
        }
        Update: {
          article?: string
          created_at?: string
          description?: string | null
          id?: string
          keywords?: string[] | null
          law_name?: string
          link?: string | null
          needs_review?: boolean | null
          process_mappings?: string[] | null
          revision_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      master_assignees: {
        Row: {
          created_at: string
          department_id: string | null
          id: string
          name: string
          phone: string | null
          position: string | null
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          id?: string
          name: string
          phone?: string | null
          position?: string | null
        }
        Update: {
          created_at?: string
          department_id?: string | null
          id?: string
          name?: string
          phone?: string | null
          position?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_assignees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      master_departments: {
        Row: {
          created_at: string
          id: string
          name: string
          project_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          project_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_departments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      master_ppe: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      master_processes: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
          project_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
          project_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          project_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_processes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          business_hours_only: boolean
          channel_email: boolean
          channel_kakao: boolean
          channel_sms: boolean
          created_at: string
          event_approval_request: boolean
          event_approval_result: boolean
          event_return_request: boolean
          event_validation_complete: boolean
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          business_hours_only?: boolean
          channel_email?: boolean
          channel_kakao?: boolean
          channel_sms?: boolean
          created_at?: string
          event_approval_request?: boolean
          event_approval_result?: boolean
          event_return_request?: boolean
          event_validation_complete?: boolean
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          business_hours_only?: boolean
          channel_email?: boolean
          channel_kakao?: boolean
          channel_sms?: boolean
          created_at?: string
          event_approval_request?: boolean
          event_approval_result?: boolean
          event_return_request?: boolean
          event_validation_complete?: boolean
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          project_id: string | null
          related_id: string | null
          related_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          project_id?: string | null
          related_id?: string | null
          related_type?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          project_id?: string | null
          related_id?: string | null
          related_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: string
          company: string | null
          created_at: string
          display_name: string
          id: string
          phone: string | null
          position: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_status?: string
          company?: string | null
          created_at?: string
          display_name?: string
          id?: string
          phone?: string | null
          position?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_status?: string
          company?: string | null
          created_at?: string
          display_name?: string
          id?: string
          phone?: string | null
          position?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_invites: {
        Row: {
          code: string
          company_id: string | null
          created_at: string
          created_by: string | null
          default_role: Database["public"]["Enums"]["app_role"]
          expires_at: string | null
          id: string
          max_uses: number | null
          project_id: string
          use_count: number | null
        }
        Insert: {
          code: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          default_role?: Database["public"]["Enums"]["app_role"]
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          project_id: string
          use_count?: number | null
        }
        Update: {
          code?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          default_role?: Database["public"]["Enums"]["app_role"]
          expires_at?: string | null
          id?: string
          max_uses?: number | null
          project_id?: string
          use_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_join_requests: {
        Row: {
          company_name: string | null
          created_at: string
          id: string
          project_id: string
          requested_role: Database["public"]["Enums"]["app_role"]
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          id?: string
          project_id: string
          requested_role?: Database["public"]["Enums"]["app_role"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string | null
          created_at?: string
          id?: string
          project_id?: string
          requested_role?: Database["public"]["Enums"]["app_role"]
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_join_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          company: string | null
          company_id: string | null
          created_at: string
          id: string
          position: string | null
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          position?: string | null
          project_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          position?: string | null
          project_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client: string | null
          contractor: string | null
          created_at: string
          created_by: string | null
          gc_company_id: string | null
          id: string
          name: string
          period_end: string | null
          period_start: string | null
          site_name: string
          status: string
          subcontractors: string[] | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          client?: string | null
          contractor?: string | null
          created_at?: string
          created_by?: string | null
          gc_company_id?: string | null
          id?: string
          name: string
          period_end?: string | null
          period_start?: string | null
          site_name?: string
          status?: string
          subcontractors?: string[] | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          client?: string | null
          contractor?: string | null
          created_at?: string
          created_by?: string | null
          gc_company_id?: string | null
          id?: string
          name?: string
          period_end?: string | null
          period_start?: string | null
          site_name?: string
          status?: string
          subcontractors?: string[] | null
          tags?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_gc_company_id_fkey"
            columns: ["gc_company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      rigging_plans: {
        Row: {
          boom_length: number | null
          calculated_utilization: number | null
          crane_capacity: number | null
          crane_model: string | null
          created_at: string
          ground_bearing_capacity: number | null
          id: string
          lifting_method: string | null
          load_description: string | null
          load_weight: number
          notes: string | null
          outrigger_setup: string | null
          safety_factor: number | null
          sling_capacity: number | null
          sling_type: string | null
          updated_at: string
          work_plan_id: string
          working_radius: number | null
        }
        Insert: {
          boom_length?: number | null
          calculated_utilization?: number | null
          crane_capacity?: number | null
          crane_model?: string | null
          created_at?: string
          ground_bearing_capacity?: number | null
          id?: string
          lifting_method?: string | null
          load_description?: string | null
          load_weight?: number
          notes?: string | null
          outrigger_setup?: string | null
          safety_factor?: number | null
          sling_capacity?: number | null
          sling_type?: string | null
          updated_at?: string
          work_plan_id: string
          working_radius?: number | null
        }
        Update: {
          boom_length?: number | null
          calculated_utilization?: number | null
          crane_capacity?: number | null
          crane_model?: string | null
          created_at?: string
          ground_bearing_capacity?: number | null
          id?: string
          lifting_method?: string | null
          load_description?: string | null
          load_weight?: number
          notes?: string | null
          outrigger_setup?: string | null
          safety_factor?: number | null
          sling_capacity?: number | null
          sling_type?: string | null
          updated_at?: string
          work_plan_id?: string
          working_radius?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rigging_plans_work_plan_id_fkey"
            columns: ["work_plan_id"]
            isOneToOne: false
            referencedRelation: "work_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_item_feedback: {
        Row: {
          after_image_urls: string[] | null
          assessment_run_id: string
          assignee_user_id: string | null
          before_image_urls: string[] | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string
          feedback_type: string
          id: string
          project_id: string
          risk_item_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          after_image_urls?: string[] | null
          assessment_run_id: string
          assignee_user_id?: string | null
          before_image_urls?: string[] | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          feedback_type?: string
          id?: string
          project_id: string
          risk_item_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          after_image_urls?: string[] | null
          assessment_run_id?: string
          assignee_user_id?: string | null
          before_image_urls?: string[] | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          feedback_type?: string
          id?: string
          project_id?: string
          risk_item_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_item_feedback_assessment_run_id_fkey"
            columns: ["assessment_run_id"]
            isOneToOne: false
            referencedRelation: "assessment_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_item_feedback_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_item_feedback_risk_item_id_fkey"
            columns: ["risk_item_id"]
            isOneToOne: false
            referencedRelation: "risk_items"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_item_versions: {
        Row: {
          change_reason: string | null
          changed_at: string | null
          changed_by: string | null
          data: Json
          id: string
          risk_item_id: string
          version_number: number
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string | null
          changed_by?: string | null
          data: Json
          id?: string
          risk_item_id: string
          version_number: number
        }
        Update: {
          change_reason?: string | null
          changed_at?: string | null
          changed_by?: string | null
          data?: Json
          id?: string
          risk_item_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "risk_item_versions_risk_item_id_fkey"
            columns: ["risk_item_id"]
            isOneToOne: false
            referencedRelation: "risk_items"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_items: {
        Row: {
          assignee: string | null
          assignee_user_id: string | null
          batch_id: string | null
          created_at: string
          created_by: string | null
          department: string | null
          excluded_at: string | null
          excluded_by: string | null
          excluded_reason: string | null
          existing_measure: string | null
          frequency: number
          hazard: string | null
          hazard_situation: string | null
          id: string
          improved_frequency: number
          improved_likelihood_grade: string
          improved_risk: number | null
          improved_risk_grade: string
          improved_severity: number
          improved_severity_grade: string
          improvement_measure: string | null
          is_excluded: boolean
          is_locked: boolean | null
          legal_basis: string[] | null
          likelihood_grade: string
          note: string | null
          ppe: string[] | null
          process: string
          project_id: string
          responsible_department_id: string | null
          risk: number | null
          risk_grade: string
          run_id: string | null
          severity: number
          severity_grade: string
          sort_order: number | null
          status: string
          sub_task: string | null
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
          version_number: number | null
        }
        Insert: {
          assignee?: string | null
          assignee_user_id?: string | null
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          excluded_at?: string | null
          excluded_by?: string | null
          excluded_reason?: string | null
          existing_measure?: string | null
          frequency?: number
          hazard?: string | null
          hazard_situation?: string | null
          id?: string
          improved_frequency?: number
          improved_likelihood_grade?: string
          improved_risk?: number | null
          improved_risk_grade?: string
          improved_severity?: number
          improved_severity_grade?: string
          improvement_measure?: string | null
          is_excluded?: boolean
          is_locked?: boolean | null
          legal_basis?: string[] | null
          likelihood_grade?: string
          note?: string | null
          ppe?: string[] | null
          process: string
          project_id: string
          responsible_department_id?: string | null
          risk?: number | null
          risk_grade?: string
          run_id?: string | null
          severity?: number
          severity_grade?: string
          sort_order?: number | null
          status?: string
          sub_task?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          version_number?: number | null
        }
        Update: {
          assignee?: string | null
          assignee_user_id?: string | null
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          excluded_at?: string | null
          excluded_by?: string | null
          excluded_reason?: string | null
          existing_measure?: string | null
          frequency?: number
          hazard?: string | null
          hazard_situation?: string | null
          id?: string
          improved_frequency?: number
          improved_likelihood_grade?: string
          improved_risk?: number | null
          improved_risk_grade?: string
          improved_severity?: number
          improved_severity_grade?: string
          improvement_measure?: string | null
          is_excluded?: boolean
          is_locked?: boolean | null
          legal_basis?: string[] | null
          likelihood_grade?: string
          note?: string | null
          ppe?: string[] | null
          process?: string
          project_id?: string
          responsible_department_id?: string | null
          risk?: number | null
          risk_grade?: string
          run_id?: string | null
          severity?: number
          severity_grade?: string
          sort_order?: number | null
          status?: string
          sub_task?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
          version_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_items_responsible_department_id_fkey"
            columns: ["responsible_department_id"]
            isOneToOne: false
            referencedRelation: "master_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "assessment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_templates: {
        Row: {
          created_at: string
          department: string | null
          existing_measure: string | null
          frequency: number
          hazard: string
          hazard_situation: string
          id: string
          improved_frequency: number
          improved_likelihood_grade: string
          improved_severity: number
          improved_severity_grade: string
          improvement_measure: string | null
          legal_keywords: string[] | null
          likelihood_grade: string
          ppe: string[] | null
          process_keyword: string
          severity: number
          severity_grade: string
          sub_task: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          existing_measure?: string | null
          frequency?: number
          hazard: string
          hazard_situation: string
          id?: string
          improved_frequency?: number
          improved_likelihood_grade?: string
          improved_severity?: number
          improved_severity_grade?: string
          improvement_measure?: string | null
          legal_keywords?: string[] | null
          likelihood_grade?: string
          ppe?: string[] | null
          process_keyword: string
          severity?: number
          severity_grade?: string
          sub_task: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string | null
          existing_measure?: string | null
          frequency?: number
          hazard?: string
          hazard_situation?: string
          id?: string
          improved_frequency?: number
          improved_likelihood_grade?: string
          improved_severity?: number
          improved_severity_grade?: string
          improvement_measure?: string | null
          legal_keywords?: string[] | null
          likelihood_grade?: string
          ppe?: string[] | null
          process_keyword?: string
          severity?: number
          severity_grade?: string
          sub_task?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_uploads: {
        Row: {
          column_mapping: Json | null
          created_at: string | null
          file_name: string
          file_path: string
          id: string
          parsed_rows: Json | null
          project_id: string
          status: string | null
          total_generated: number | null
          uploaded_by: string | null
        }
        Insert: {
          column_mapping?: Json | null
          created_at?: string | null
          file_name: string
          file_path?: string
          id?: string
          parsed_rows?: Json | null
          project_id: string
          status?: string | null
          total_generated?: number | null
          uploaded_by?: string | null
        }
        Update: {
          column_mapping?: Json | null
          created_at?: string | null
          file_name?: string
          file_path?: string
          id?: string
          parsed_rows?: Json | null
          project_id?: string
          status?: string | null
          total_generated?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_config: {
        Row: {
          config_key: string
          config_value: Json
          description: string | null
          id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          config_key: string
          config_value?: Json
          description?: string | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          config_key?: string
          config_value?: Json
          description?: string | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      standard_risk_library: {
        Row: {
          category_large: string
          category_medium: string
          category_small: string
          created_at: string | null
          default_frequency: number | null
          default_likelihood_grade: string
          default_severity: number | null
          default_severity_grade: string
          equipment: string[] | null
          existing_measure: string | null
          hazard: string
          hazard_situation: string
          id: string
          improvement_measure: string | null
          is_active: boolean | null
          keywords: string[] | null
          legal_refs: string[] | null
          recommended_ppe: string[] | null
          sub_task: string
          synonyms: string[] | null
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          category_large: string
          category_medium?: string
          category_small?: string
          created_at?: string | null
          default_frequency?: number | null
          default_likelihood_grade?: string
          default_severity?: number | null
          default_severity_grade?: string
          equipment?: string[] | null
          existing_measure?: string | null
          hazard: string
          hazard_situation: string
          id?: string
          improvement_measure?: string | null
          is_active?: boolean | null
          keywords?: string[] | null
          legal_refs?: string[] | null
          recommended_ppe?: string[] | null
          sub_task: string
          synonyms?: string[] | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          category_large?: string
          category_medium?: string
          category_small?: string
          created_at?: string | null
          default_frequency?: number | null
          default_likelihood_grade?: string
          default_severity?: number | null
          default_severity_grade?: string
          equipment?: string[] | null
          existing_measure?: string | null
          hazard?: string
          hazard_situation?: string
          id?: string
          improvement_measure?: string | null
          is_active?: boolean | null
          keywords?: string[] | null
          legal_refs?: string[] | null
          recommended_ppe?: string[] | null
          sub_task?: string
          synonyms?: string[] | null
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      todo_items: {
        Row: {
          company_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          description: string | null
          due_date: string
          frequency: string
          id: string
          legal_duty_id: string | null
          project_id: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          company_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date: string
          frequency?: string
          id?: string
          legal_duty_id?: string | null
          project_id: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          company_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string
          frequency?: string
          id?: string
          legal_duty_id?: string | null
          project_id?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "todo_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_items_legal_duty_id_fkey"
            columns: ["legal_duty_id"]
            isOneToOne: false
            referencedRelation: "legal_duties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "todo_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      validation_results: {
        Row: {
          batch_id: string | null
          created_at: string | null
          id: string
          message: string | null
          project_id: string
          risk_item_id: string | null
          rule_id: string | null
          run_id: string | null
          status: string
          validated_by: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          project_id: string
          risk_item_id?: string | null
          rule_id?: string | null
          run_id?: string | null
          status?: string
          validated_by?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          project_id?: string
          risk_item_id?: string | null
          rule_id?: string | null
          run_id?: string | null
          status?: string
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "validation_results_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_results_risk_item_id_fkey"
            columns: ["risk_item_id"]
            isOneToOne: false
            referencedRelation: "risk_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_results_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "validation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "validation_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "assessment_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_rules: {
        Row: {
          check_config: Json | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          rule_name: string
          rule_type: string
          severity: string | null
          weight: number | null
        }
        Insert: {
          check_config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          rule_name: string
          rule_type: string
          severity?: string | null
          weight?: number | null
        }
        Update: {
          check_config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          rule_name?: string
          rule_type?: string
          severity?: string | null
          weight?: number | null
        }
        Relationships: []
      }
      work_plans: {
        Row: {
          attachments: Json
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          project_id: string
          sections: Json
          status: string
          title: string
          updated_at: string
          work_type: string
        }
        Insert: {
          attachments?: Json
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          project_id: string
          sections?: Json
          status?: string
          title?: string
          updated_at?: string
          work_type: string
        }
        Update: {
          attachments?: Json
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          project_id?: string
          sections?: Json
          status?: string
          title?: string
          updated_at?: string
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ensure_master_allowlist: {
        Args: { _user_id: string }
        Returns: undefined
      }
      get_project_role: {
        Args: { _project_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_company_project_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      list_joinable_projects: {
        Args: never
        Returns: {
          id: string
          name: string
          site_name: string
          status: string
        }[]
      }
      process_invite_code: {
        Args: { _invite_code: string; _user_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "master"
        | "project_admin"
        | "safety_manager"
        | "contractor"
        | "viewer"
        | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "master",
        "project_admin",
        "safety_manager",
        "contractor",
        "viewer",
        "user",
      ],
    },
  },
} as const
