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
      accident_cases: {
        Row: {
          accident_type: string
          cause: string
          created_at: string
          description: string | null
          equipment: string | null
          fatality: boolean | null
          id: string
          injury_count: number | null
          keywords: string[] | null
          location_type: string | null
          occurrence_date: string | null
          prevention_measures: string[] | null
          process_category: string
          related_law: string | null
          result: string
          risk_factors: string[] | null
          source: string | null
          updated_at: string
        }
        Insert: {
          accident_type?: string
          cause?: string
          created_at?: string
          description?: string | null
          equipment?: string | null
          fatality?: boolean | null
          id?: string
          injury_count?: number | null
          keywords?: string[] | null
          location_type?: string | null
          occurrence_date?: string | null
          prevention_measures?: string[] | null
          process_category?: string
          related_law?: string | null
          result?: string
          risk_factors?: string[] | null
          source?: string | null
          updated_at?: string
        }
        Update: {
          accident_type?: string
          cause?: string
          created_at?: string
          description?: string | null
          equipment?: string | null
          fatality?: boolean | null
          id?: string
          injury_count?: number | null
          keywords?: string[] | null
          location_type?: string | null
          occurrence_date?: string | null
          prevention_measures?: string[] | null
          process_category?: string
          related_law?: string | null
          result?: string
          risk_factors?: string[] | null
          source?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_generated_items_buffer: {
        Row: {
          batch_index: number
          created_at: string
          id: string
          items: Json
          job_id: string
        }
        Insert: {
          batch_index?: number
          created_at?: string
          id?: string
          items?: Json
          job_id: string
        }
        Update: {
          batch_index?: number
          created_at?: string
          id?: string
          items?: Json
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generated_items_buffer_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ai_generation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generation_jobs: {
        Row: {
          completed_at: string | null
          completed_batches: number
          created_at: string
          created_by: string
          diversity_score: number | null
          duplicate_rate: number | null
          equipment: string | null
          error_message: string | null
          id: string
          items_generated: number
          process_name: string
          project_id: string
          quality_score: number | null
          run_id: string | null
          started_at: string | null
          status: string
          target_count: number
          total_batches: number
          updated_at: string
          work_description: string | null
          work_environment: Json | null
          work_location: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_batches?: number
          created_at?: string
          created_by: string
          diversity_score?: number | null
          duplicate_rate?: number | null
          equipment?: string | null
          error_message?: string | null
          id?: string
          items_generated?: number
          process_name: string
          project_id: string
          quality_score?: number | null
          run_id?: string | null
          started_at?: string | null
          status?: string
          target_count?: number
          total_batches?: number
          updated_at?: string
          work_description?: string | null
          work_environment?: Json | null
          work_location?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_batches?: number
          created_at?: string
          created_by?: string
          diversity_score?: number | null
          duplicate_rate?: number | null
          equipment?: string | null
          error_message?: string | null
          id?: string
          items_generated?: number
          process_name?: string
          project_id?: string
          quality_score?: number | null
          run_id?: string | null
          started_at?: string | null
          status?: string
          target_count?: number
          total_batches?: number
          updated_at?: string
          work_description?: string | null
          work_environment?: Json | null
          work_location?: string | null
        }
        Relationships: []
      }
      ai_generation_logs: {
        Row: {
          batch_index: number
          created_at: string
          error: string | null
          id: string
          job_id: string
          latency_ms: number | null
          model: string | null
          prompt: string | null
          raw_response: Json | null
          tokens_used: number | null
        }
        Insert: {
          batch_index?: number
          created_at?: string
          error?: string | null
          id?: string
          job_id: string
          latency_ms?: number | null
          model?: string | null
          prompt?: string | null
          raw_response?: Json | null
          tokens_used?: number | null
        }
        Update: {
          batch_index?: number
          created_at?: string
          error?: string | null
          id?: string
          job_id?: string
          latency_ms?: number | null
          model?: string | null
          prompt?: string | null
          raw_response?: Json | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ai_generation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
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
      ai_settings: {
        Row: {
          api_key_encrypted: string
          api_key_hint: string
          created_at: string
          id: string
          is_enabled: boolean
          model: string
          project_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          api_key_encrypted?: string
          api_key_hint?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          model?: string
          project_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          api_key_encrypted?: string
          api_key_hint?: string
          created_at?: string
          id?: string
          is_enabled?: boolean
          model?: string
          project_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      ai_test_runs: {
        Row: {
          created_at: string
          duration_ms: number | null
          error_location: string | null
          id: string
          input_params: Json | null
          pass_fail: string | null
          result: Json | null
          test_type: string
          tested_by: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error_location?: string | null
          id?: string
          input_params?: Json | null
          pass_fail?: string | null
          result?: Json | null
          test_type: string
          tested_by: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error_location?: string | null
          id?: string
          input_params?: Json | null
          pass_fail?: string | null
          result?: Json | null
          test_type?: string
          tested_by?: string
        }
        Relationships: []
      }
      app_releases: {
        Row: {
          bundle_url: string
          channel: string
          checksum: string | null
          created_at: string
          created_by: string | null
          id: string
          is_deleted: boolean
          mandatory: boolean
          min_native_version: string | null
          notes: string | null
          released_at: string
          updated_at: string
          version: string
        }
        Insert: {
          bundle_url: string
          channel?: string
          checksum?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_deleted?: boolean
          mandatory?: boolean
          min_native_version?: string | null
          notes?: string | null
          released_at?: string
          updated_at?: string
          version: string
        }
        Update: {
          bundle_url?: string
          channel?: string
          checksum?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_deleted?: boolean
          mandatory?: boolean
          min_native_version?: string | null
          notes?: string | null
          released_at?: string
          updated_at?: string
          version?: string
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
            foreignKeyName: "approval_lines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "approval_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      approval_route_templates: {
        Row: {
          assessment_type: string
          company_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          entity_type: string
          id: string
          is_default: boolean
          is_deleted: boolean
          name: string
          project_id: string
          steps: Json
          updated_at: string
        }
        Insert: {
          assessment_type?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          entity_type?: string
          id?: string
          is_default?: boolean
          is_deleted?: boolean
          name?: string
          project_id: string
          steps?: Json
          updated_at?: string
        }
        Update: {
          assessment_type?: string
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          entity_type?: string
          id?: string
          is_default?: boolean
          is_deleted?: boolean
          name?: string
          project_id?: string
          steps?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_route_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_route_templates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "approval_route_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_route_templates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
          entity_id: string | null
          entity_type: string | null
          id: string
          position: string | null
          project_id: string
          risk_item_id: string | null
          run_id: string | null
          status: string
          step: string
          step_order: number | null
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
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          position?: string | null
          project_id: string
          risk_item_id?: string | null
          run_id?: string | null
          status?: string
          step: string
          step_order?: number | null
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
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          position?: string | null
          project_id?: string
          risk_item_id?: string | null
          run_id?: string | null
          status?: string
          step?: string
          step_order?: number | null
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
            foreignKeyName: "approvals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
      assessment_accidents: {
        Row: {
          accident_type: string | null
          cause: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          occurrence_date: string | null
          photo_urls: string[] | null
          prevention: string | null
          process: string | null
          project_id: string
          reference_case_id: string | null
          result: string | null
          run_id: string
          source_type: string
          updated_at: string
        }
        Insert: {
          accident_type?: string | null
          cause?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          occurrence_date?: string | null
          photo_urls?: string[] | null
          prevention?: string | null
          process?: string | null
          project_id: string
          reference_case_id?: string | null
          result?: string | null
          run_id: string
          source_type?: string
          updated_at?: string
        }
        Update: {
          accident_type?: string | null
          cause?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          occurrence_date?: string | null
          photo_urls?: string[] | null
          prevention?: string | null
          process?: string | null
          project_id?: string
          reference_case_id?: string | null
          result?: string | null
          run_id?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      assessment_notices: {
        Row: {
          acknowledged_worker_ids: string[] | null
          body: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          posted_at: string
          project_id: string
          run_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_worker_ids?: string[] | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          posted_at?: string
          project_id: string
          run_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_worker_ids?: string[] | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          posted_at?: string
          project_id?: string
          run_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_notices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_notices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "assessment_notices_run_id_fkey"
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
          health_required: boolean
          id: string
          is_deleted: boolean
          notes: string | null
          opinion_required: boolean
          period_label: string
          project_id: string
          start_date: string | null
          status: string
          target_company_ids: string[] | null
          target_contractors: string[] | null
          target_processes: string[] | null
          tbm_images: string[] | null
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
          health_required?: boolean
          id?: string
          is_deleted?: boolean
          notes?: string | null
          opinion_required?: boolean
          period_label?: string
          project_id: string
          start_date?: string | null
          status?: string
          target_company_ids?: string[] | null
          target_contractors?: string[] | null
          target_processes?: string[] | null
          tbm_images?: string[] | null
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
          health_required?: boolean
          id?: string
          is_deleted?: boolean
          notes?: string | null
          opinion_required?: boolean
          period_label?: string
          project_id?: string
          start_date?: string | null
          status?: string
          target_company_ids?: string[] | null
          target_contractors?: string[] | null
          target_processes?: string[] | null
          tbm_images?: string[] | null
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
          {
            foreignKeyName: "assessment_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
          {
            foreignKeyName: "audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          action_type: string | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          action_type?: string | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          action_type?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_usage_plans: {
        Row: {
          actual_qty: number | null
          chemical_id: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          is_deleted: boolean | null
          legal_basis: string | null
          month: number | null
          notes: string | null
          plan_type: string
          planned_qty: number | null
          project_id: string
          storage_max_qty: number | null
          unit: string | null
          updated_at: string
          year: number
        }
        Insert: {
          actual_qty?: number | null
          chemical_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_deleted?: boolean | null
          legal_basis?: string | null
          month?: number | null
          notes?: string | null
          plan_type: string
          planned_qty?: number | null
          project_id: string
          storage_max_qty?: number | null
          unit?: string | null
          updated_at?: string
          year: number
        }
        Update: {
          actual_qty?: number | null
          chemical_id?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_deleted?: boolean | null
          legal_basis?: string | null
          month?: number | null
          notes?: string | null
          plan_type?: string
          planned_qty?: number | null
          project_id?: string
          storage_max_qty?: number | null
          unit?: string | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "chemical_usage_plans_chemical_id_fkey"
            columns: ["chemical_id"]
            isOneToOne: false
            referencedRelation: "chemicals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_usage_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_usage_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "chemical_usage_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_usage_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      chemical_workers: {
        Row: {
          chemical_id: string
          created_at: string | null
          id: string
          msds_education_at: string | null
          project_id: string
          worker_id: string
        }
        Insert: {
          chemical_id: string
          created_at?: string | null
          id?: string
          msds_education_at?: string | null
          project_id: string
          worker_id: string
        }
        Update: {
          chemical_id?: string
          created_at?: string | null
          id?: string
          msds_education_at?: string | null
          project_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chemical_workers_chemical_id_fkey"
            columns: ["chemical_id"]
            isOneToOne: false
            referencedRelation: "chemicals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_workers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_workers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "chemical_workers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      chemicals: {
        Row: {
          cas_no: string | null
          company_id: string | null
          created_at: string | null
          created_by: string | null
          hazard_class: string | null
          hazard_pictograms: Json | null
          id: string
          is_carcinogen: boolean | null
          is_deleted: boolean | null
          is_reproductive_toxin: boolean | null
          monthly_usage: number | null
          msds_file_url: string | null
          name: string
          notes: string | null
          project_id: string
          storage_location: string | null
          trade_name: string | null
          unit: string | null
          updated_at: string | null
          warning_label_url: string | null
        }
        Insert: {
          cas_no?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          hazard_class?: string | null
          hazard_pictograms?: Json | null
          id?: string
          is_carcinogen?: boolean | null
          is_deleted?: boolean | null
          is_reproductive_toxin?: boolean | null
          monthly_usage?: number | null
          msds_file_url?: string | null
          name: string
          notes?: string | null
          project_id: string
          storage_location?: string | null
          trade_name?: string | null
          unit?: string | null
          updated_at?: string | null
          warning_label_url?: string | null
        }
        Update: {
          cas_no?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          hazard_class?: string | null
          hazard_pictograms?: Json | null
          id?: string
          is_carcinogen?: boolean | null
          is_deleted?: boolean | null
          is_reproductive_toxin?: boolean | null
          monthly_usage?: number | null
          msds_file_url?: string | null
          name?: string
          notes?: string | null
          project_id?: string
          storage_location?: string | null
          trade_name?: string | null
          unit?: string | null
          updated_at?: string | null
          warning_label_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemicals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemicals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "chemicals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemicals_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
            foreignKeyName: "comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_deleted: boolean
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
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
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
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
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
            foreignKeyName: "companies_parent_company_id_fkey"
            columns: ["parent_company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "companies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
            foreignKeyName: "company_construction_info_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_construction_info_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_construction_info_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      company_daily_qr: {
        Row: {
          company_id: string
          created_at: string
          expires_at: string
          id: string
          issued_by: string | null
          project_id: string
          qr_token: string
          work_date: string
        }
        Insert: {
          company_id: string
          created_at?: string
          expires_at: string
          id?: string
          issued_by?: string | null
          project_id: string
          qr_token: string
          work_date: string
        }
        Update: {
          company_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          issued_by?: string | null
          project_id?: string
          qr_token?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_daily_qr_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_daily_qr_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_daily_qr_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_daily_qr_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      company_departments: {
        Row: {
          company_id: string
          created_at: string
          id: string
          is_deleted: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          is_deleted?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_departments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
        ]
      }
      company_managers: {
        Row: {
          company_id: string
          created_at: string
          department_id: string | null
          email: string | null
          id: string
          is_deleted: boolean
          is_primary: boolean
          name: string
          phone: string | null
          position: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          department_id?: string | null
          email?: string | null
          id?: string
          is_deleted?: boolean
          is_primary?: boolean
          name: string
          phone?: string | null
          position?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          department_id?: string | null
          email?: string | null
          id?: string
          is_deleted?: boolean
          is_primary?: boolean
          name?: string
          phone?: string | null
          position?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_managers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_managers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_managers_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "company_departments"
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
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
        ]
      }
      confined_space_permits: {
        Row: {
          co_ppm: number | null
          company_id: string | null
          created_at: string
          created_by: string | null
          flammable_lel_pct: number | null
          h2s_ppm: number | null
          id: string
          is_deleted: boolean | null
          is_safe: boolean | null
          location: string
          measured_at: string | null
          measured_by: string | null
          notes: string | null
          o2_pct: number | null
          project_id: string
          rescue_plan: string | null
          supervisor_name: string | null
          updated_at: string
          ventilation_method: string | null
          work_date: string
          work_permit_id: string | null
        }
        Insert: {
          co_ppm?: number | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          flammable_lel_pct?: number | null
          h2s_ppm?: number | null
          id?: string
          is_deleted?: boolean | null
          is_safe?: boolean | null
          location: string
          measured_at?: string | null
          measured_by?: string | null
          notes?: string | null
          o2_pct?: number | null
          project_id: string
          rescue_plan?: string | null
          supervisor_name?: string | null
          updated_at?: string
          ventilation_method?: string | null
          work_date: string
          work_permit_id?: string | null
        }
        Update: {
          co_ppm?: number | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          flammable_lel_pct?: number | null
          h2s_ppm?: number | null
          id?: string
          is_deleted?: boolean | null
          is_safe?: boolean | null
          location?: string
          measured_at?: string | null
          measured_by?: string | null
          notes?: string | null
          o2_pct?: number | null
          project_id?: string
          rescue_plan?: string | null
          supervisor_name?: string | null
          updated_at?: string
          ventilation_method?: string | null
          work_date?: string
          work_permit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "confined_space_permits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confined_space_permits_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "confined_space_permits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "confined_space_permits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "confined_space_permits_work_permit_id_fkey"
            columns: ["work_permit_id"]
            isOneToOne: false
            referencedRelation: "work_permits"
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
            referencedRelation: "company_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_assignees_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "department_assignees_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
            foreignKeyName: "dismissed_recommendations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
      emergency_drills: {
        Row: {
          attachments: Json
          company_id: string | null
          conducted_date: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          drill_type: string
          id: string
          improvements: string
          is_deleted: boolean
          issues_found: string
          leader_name: string
          legal_basis: string
          location: string
          next_due_date: string | null
          participants: Json
          participants_count: number
          photos: string[]
          project_id: string
          scenario: string
          scheduled_date: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          attachments?: Json
          company_id?: string | null
          conducted_date?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          drill_type?: string
          id?: string
          improvements?: string
          is_deleted?: boolean
          issues_found?: string
          leader_name?: string
          legal_basis?: string
          location?: string
          next_due_date?: string | null
          participants?: Json
          participants_count?: number
          photos?: string[]
          project_id: string
          scenario?: string
          scheduled_date?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          attachments?: Json
          company_id?: string | null
          conducted_date?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          drill_type?: string
          id?: string
          improvements?: string
          is_deleted?: boolean
          issues_found?: string
          leader_name?: string
          legal_basis?: string
          location?: string
          next_due_date?: string | null
          participants?: Json
          participants_count?: number
          photos?: string[]
          project_id?: string
          scenario?: string
          scheduled_date?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_drills_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_drills_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "emergency_drills_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_drills_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      environment_tags: {
        Row: {
          category: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_default: boolean | null
          is_deleted: boolean
          name: string
          project_id: string | null
          sort_order: number | null
        }
        Insert: {
          category?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_default?: boolean | null
          is_deleted?: boolean
          name: string
          project_id?: string | null
          sort_order?: number | null
        }
        Update: {
          category?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_default?: boolean | null
          is_deleted?: boolean
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
          {
            foreignKeyName: "environment_tags_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      equipment_master: {
        Row: {
          company_id: string | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_default: boolean | null
          is_deleted: boolean
          manufacturer: string | null
          model_name: string | null
          name: string
          project_id: string
          rated_capacity: number | null
          updated_at: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_default?: boolean | null
          is_deleted?: boolean
          manufacturer?: string | null
          model_name?: string | null
          name: string
          project_id: string
          rated_capacity?: number | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_default?: boolean | null
          is_deleted?: boolean
          manufacturer?: string | null
          model_name?: string | null
          name?: string
          project_id?: string
          rated_capacity?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_master_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_master_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "equipment_master_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_master_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      generated_batches: {
        Row: {
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_deleted: boolean
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
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
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
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
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
          {
            foreignKeyName: "generated_batches_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      hazard_survey_responses: {
        Row: {
          ai_summary: string | null
          company_name: string | null
          created_at: string | null
          id: string
          ip_hash: string | null
          project_id: string
          risk_level: string | null
          scores: Json | null
          survey_id: string
          total_score: number | null
          worker_id: string | null
          worker_name: string | null
          worker_phone: string | null
        }
        Insert: {
          ai_summary?: string | null
          company_name?: string | null
          created_at?: string | null
          id?: string
          ip_hash?: string | null
          project_id: string
          risk_level?: string | null
          scores?: Json | null
          survey_id: string
          total_score?: number | null
          worker_id?: string | null
          worker_name?: string | null
          worker_phone?: string | null
        }
        Update: {
          ai_summary?: string | null
          company_name?: string | null
          created_at?: string | null
          id?: string
          ip_hash?: string | null
          project_id?: string
          risk_level?: string | null
          scores?: Json | null
          survey_id?: string
          total_score?: number | null
          worker_id?: string | null
          worker_name?: string | null
          worker_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hazard_survey_responses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_survey_responses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "hazard_survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "hazard_surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_survey_responses_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      hazard_surveys: {
        Row: {
          actions: Json | null
          company_id: string | null
          created_at: string | null
          created_by: string | null
          findings: Json | null
          high_risk_count: number | null
          id: string
          is_active: boolean | null
          is_deleted: boolean | null
          next_due_date: string | null
          project_id: string
          qr_token: string | null
          response_count: number | null
          survey_date: string
          target_count: number | null
          title: string
          type: Database["public"]["Enums"]["hazard_survey_type"]
          updated_at: string | null
        }
        Insert: {
          actions?: Json | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          findings?: Json | null
          high_risk_count?: number | null
          id?: string
          is_active?: boolean | null
          is_deleted?: boolean | null
          next_due_date?: string | null
          project_id: string
          qr_token?: string | null
          response_count?: number | null
          survey_date: string
          target_count?: number | null
          title: string
          type: Database["public"]["Enums"]["hazard_survey_type"]
          updated_at?: string | null
        }
        Update: {
          actions?: Json | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          findings?: Json | null
          high_risk_count?: number | null
          id?: string
          is_active?: boolean | null
          is_deleted?: boolean | null
          next_due_date?: string | null
          project_id?: string
          qr_token?: string | null
          response_count?: number | null
          survey_date?: string
          target_count?: number | null
          title?: string
          type?: Database["public"]["Enums"]["hazard_survey_type"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hazard_surveys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_surveys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "hazard_surveys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazard_surveys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      health_checkups: {
        Row: {
          company_id: string | null
          conducted_date: string | null
          created_at: string | null
          created_by: string | null
          followup_required: boolean | null
          followup_summary: string | null
          hazard_factors: Json | null
          id: string
          institution: string | null
          is_deleted: boolean | null
          next_due_date: string | null
          notes: string | null
          project_id: string
          report_url: string | null
          restrictions: string | null
          result: Database["public"]["Enums"]["health_checkup_result"] | null
          scheduled_date: string | null
          type: Database["public"]["Enums"]["health_checkup_type"]
          updated_at: string | null
          worker_id: string | null
          worker_name: string | null
          worker_phone: string | null
        }
        Insert: {
          company_id?: string | null
          conducted_date?: string | null
          created_at?: string | null
          created_by?: string | null
          followup_required?: boolean | null
          followup_summary?: string | null
          hazard_factors?: Json | null
          id?: string
          institution?: string | null
          is_deleted?: boolean | null
          next_due_date?: string | null
          notes?: string | null
          project_id: string
          report_url?: string | null
          restrictions?: string | null
          result?: Database["public"]["Enums"]["health_checkup_result"] | null
          scheduled_date?: string | null
          type: Database["public"]["Enums"]["health_checkup_type"]
          updated_at?: string | null
          worker_id?: string | null
          worker_name?: string | null
          worker_phone?: string | null
        }
        Update: {
          company_id?: string | null
          conducted_date?: string | null
          created_at?: string | null
          created_by?: string | null
          followup_required?: boolean | null
          followup_summary?: string | null
          hazard_factors?: Json | null
          id?: string
          institution?: string | null
          is_deleted?: boolean | null
          next_due_date?: string | null
          notes?: string | null
          project_id?: string
          report_url?: string | null
          restrictions?: string | null
          result?: Database["public"]["Enums"]["health_checkup_result"] | null
          scheduled_date?: string | null
          type?: Database["public"]["Enums"]["health_checkup_type"]
          updated_at?: string | null
          worker_id?: string | null
          worker_name?: string | null
          worker_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "health_checkups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_checkups_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "health_checkups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_checkups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "health_checkups_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      health_education_logs: {
        Row: {
          attachment_url: string | null
          company_id: string | null
          conducted_at: string | null
          created_at: string | null
          created_by: string | null
          hours: number | null
          id: string
          instructor: string | null
          is_deleted: boolean | null
          material_id: string | null
          notes: string | null
          project_id: string
          title: string | null
          type: Database["public"]["Enums"]["health_education_type"]
          updated_at: string | null
          worker_id: string | null
          worker_name: string | null
        }
        Insert: {
          attachment_url?: string | null
          company_id?: string | null
          conducted_at?: string | null
          created_at?: string | null
          created_by?: string | null
          hours?: number | null
          id?: string
          instructor?: string | null
          is_deleted?: boolean | null
          material_id?: string | null
          notes?: string | null
          project_id: string
          title?: string | null
          type: Database["public"]["Enums"]["health_education_type"]
          updated_at?: string | null
          worker_id?: string | null
          worker_name?: string | null
        }
        Update: {
          attachment_url?: string | null
          company_id?: string | null
          conducted_at?: string | null
          created_at?: string | null
          created_by?: string | null
          hours?: number | null
          id?: string
          instructor?: string | null
          is_deleted?: boolean | null
          material_id?: string | null
          notes?: string | null
          project_id?: string
          title?: string | null
          type?: Database["public"]["Enums"]["health_education_type"]
          updated_at?: string | null
          worker_id?: string | null
          worker_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "health_education_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_education_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "health_education_logs_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "safety_education_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_education_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "health_education_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "health_education_logs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      health_hazards: {
        Row: {
          category: string
          countermeasure: string | null
          created_at: string
          created_by: string | null
          description: string | null
          exposure_level: string | null
          id: string
          is_user_reviewed: boolean
          legal_basis: string | null
          process: string | null
          project_id: string
          run_id: string
          source_type: string
          updated_at: string
        }
        Insert: {
          category?: string
          countermeasure?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          exposure_level?: string | null
          id?: string
          is_user_reviewed?: boolean
          legal_basis?: string | null
          process?: string | null
          project_id: string
          run_id: string
          source_type?: string
          updated_at?: string
        }
        Update: {
          category?: string
          countermeasure?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          exposure_level?: string | null
          id?: string
          is_user_reviewed?: boolean
          legal_basis?: string | null
          process?: string | null
          project_id?: string
          run_id?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      incident_reports: {
        Row: {
          authority_report_no: string | null
          company_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          description: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          incident_type: string
          is_deleted: boolean
          is_major: boolean
          legal_deadline_at: string | null
          location: string
          occurred_at: string
          photos: string[]
          project_id: string
          reported_to_authority_at: string | null
          reporter_id: string | null
          reporter_name: string
          review_note: string
          reviewed_at: string | null
          reviewed_by: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          authority_report_no?: string | null
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          description?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          incident_type?: string
          is_deleted?: boolean
          is_major?: boolean
          legal_deadline_at?: string | null
          location?: string
          occurred_at?: string
          photos?: string[]
          project_id: string
          reported_to_authority_at?: string | null
          reporter_id?: string | null
          reporter_name?: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          authority_report_no?: string | null
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          description?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          incident_type?: string
          is_deleted?: boolean
          is_major?: boolean
          legal_deadline_at?: string | null
          location?: string
          occurred_at?: string
          photos?: string[]
          project_id?: string
          reported_to_authority_at?: string | null
          reporter_id?: string | null
          reporter_name?: string
          review_note?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
        ]
      }
      inspection_responses: {
        Row: {
          created_at: string
          created_by: string | null
          findings: Json
          id: string
          inspection_date: string
          inspector_org: string
          notes: string
          pdf_url: string
          project_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          findings?: Json
          id?: string
          inspection_date?: string
          inspector_org?: string
          notes?: string
          pdf_url?: string
          project_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          findings?: Json
          id?: string
          inspection_date?: string
          inspector_org?: string
          notes?: string
          pdf_url?: string
          project_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      legal_duties: {
        Row: {
          company_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          description: string | null
          duty_category: string
          duty_name: string
          frequency: string
          id: string
          is_active: boolean
          is_deleted: boolean
          legal_basis: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          description?: string | null
          duty_category?: string
          duty_name: string
          frequency?: string
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          legal_basis?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          description?: string | null
          duty_category?: string
          duty_name?: string
          frequency?: string
          id?: string
          is_active?: boolean
          is_deleted?: boolean
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
            foreignKeyName: "legal_duties_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "legal_duties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legal_duties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
      manual_inquiries: {
        Row: {
          category: string
          contact: string | null
          created_at: string
          id: string
          message: string
          name: string | null
          page_url: string | null
          status: string
          user_agent: string | null
        }
        Insert: {
          category: string
          contact?: string | null
          created_at?: string
          id?: string
          message: string
          name?: string | null
          page_url?: string | null
          status?: string
          user_agent?: string | null
        }
        Update: {
          category?: string
          contact?: string | null
          created_at?: string
          id?: string
          message?: string
          name?: string | null
          page_url?: string | null
          status?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      master_assignees: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          department_id: string | null
          id: string
          is_deleted: boolean
          name: string
          phone: string | null
          position: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          department_id?: string | null
          id?: string
          is_deleted?: boolean
          name: string
          phone?: string | null
          position?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          department_id?: string | null
          id?: string
          is_deleted?: boolean
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
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_deleted: boolean
          name: string
          project_id: string | null
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
          name: string
          project_id?: string | null
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
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
          {
            foreignKeyName: "master_departments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      master_ppe: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          icon: string | null
          id: string
          is_deleted: boolean
          name: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          icon?: string | null
          id?: string
          is_deleted?: boolean
          name: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          icon?: string | null
          id?: string
          is_deleted?: boolean
          name?: string
        }
        Relationships: []
      }
      master_processes: {
        Row: {
          category: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_deleted: boolean
          name: string
          project_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
          name: string
          project_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
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
          {
            foreignKeyName: "master_processes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      migration_unmapped_members: {
        Row: {
          created_at: string
          id: string
          project_id: string | null
          project_member_id: string | null
          raw_company_text: string | null
          raw_position: string | null
          raw_role: string | null
          reason: string | null
          resolved: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          project_id?: string | null
          project_member_id?: string | null
          raw_company_text?: string | null
          raw_position?: string | null
          raw_role?: string | null
          reason?: string | null
          resolved?: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string | null
          project_member_id?: string | null
          raw_company_text?: string | null
          raw_position?: string | null
          raw_role?: string | null
          reason?: string | null
          resolved?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "migration_unmapped_members_project_member_id_fkey"
            columns: ["project_member_id"]
            isOneToOne: false
            referencedRelation: "project_members"
            referencedColumns: ["id"]
          },
        ]
      }
      mobile_idempotency_keys: {
        Row: {
          action: string
          created_at: string
          key: string
          response: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          key: string
          response?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          key?: string
          response?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      musculoskeletal_surveys: {
        Row: {
          attachments: Json | null
          company_id: string | null
          created_at: string
          created_by: string | null
          id: string
          improvement_plan: string | null
          is_deleted: boolean | null
          legal_basis: string | null
          next_due_date: string | null
          process_name: string | null
          project_id: string
          risk_level: string | null
          survey_date: string
          symptom_count: number | null
          task_description: string | null
          updated_at: string
          worker_count: number | null
        }
        Insert: {
          attachments?: Json | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          improvement_plan?: string | null
          is_deleted?: boolean | null
          legal_basis?: string | null
          next_due_date?: string | null
          process_name?: string | null
          project_id: string
          risk_level?: string | null
          survey_date: string
          symptom_count?: number | null
          task_description?: string | null
          updated_at?: string
          worker_count?: number | null
        }
        Update: {
          attachments?: Json | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          improvement_plan?: string | null
          is_deleted?: boolean | null
          legal_basis?: string | null
          next_due_date?: string | null
          process_name?: string | null
          project_id?: string
          risk_level?: string | null
          survey_date?: string
          symptom_count?: number | null
          task_description?: string | null
          updated_at?: string
          worker_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "musculoskeletal_surveys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "musculoskeletal_surveys_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "musculoskeletal_surveys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "musculoskeletal_surveys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          business_hours_only: boolean
          channel_email: boolean
          channel_in_app: boolean
          channel_kakao: boolean
          channel_push: boolean
          channel_sms: boolean
          created_at: string
          event_approval_request: boolean
          event_approval_result: boolean
          event_assessment_result: boolean
          event_general: boolean
          event_health_checkup_due: boolean
          event_health_warning: boolean
          event_incident: boolean
          event_return_request: boolean
          event_safety_inspection: boolean
          event_tbm: boolean
          event_todo_due: boolean
          event_validation_complete: boolean
          event_work_permit: boolean
          id: string
          push_quiet_end: string | null
          push_quiet_start: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_hours_only?: boolean
          channel_email?: boolean
          channel_in_app?: boolean
          channel_kakao?: boolean
          channel_push?: boolean
          channel_sms?: boolean
          created_at?: string
          event_approval_request?: boolean
          event_approval_result?: boolean
          event_assessment_result?: boolean
          event_general?: boolean
          event_health_checkup_due?: boolean
          event_health_warning?: boolean
          event_incident?: boolean
          event_return_request?: boolean
          event_safety_inspection?: boolean
          event_tbm?: boolean
          event_todo_due?: boolean
          event_validation_complete?: boolean
          event_work_permit?: boolean
          id?: string
          push_quiet_end?: string | null
          push_quiet_start?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_hours_only?: boolean
          channel_email?: boolean
          channel_in_app?: boolean
          channel_kakao?: boolean
          channel_push?: boolean
          channel_sms?: boolean
          created_at?: string
          event_approval_request?: boolean
          event_approval_result?: boolean
          event_assessment_result?: boolean
          event_general?: boolean
          event_health_checkup_due?: boolean
          event_health_warning?: boolean
          event_incident?: boolean
          event_return_request?: boolean
          event_safety_inspection?: boolean
          event_tbm?: boolean
          event_todo_due?: boolean
          event_validation_complete?: boolean
          event_work_permit?: boolean
          id?: string
          push_quiet_end?: string | null
          push_quiet_start?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string
          project_id: string | null
          related_id: string | null
          related_type: string | null
          severity: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          project_id?: string | null
          related_id?: string | null
          related_type?: string | null
          severity?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          project_id?: string | null
          related_id?: string | null
          related_type?: string | null
          severity?: string | null
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
          {
            foreignKeyName: "notifications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      pii_access_logs: {
        Row: {
          access_type: string
          created_at: string
          fields: string[] | null
          id: string
          ip_address: string | null
          project_id: string | null
          reason: string | null
          user_id: string | null
          worker_id: string | null
        }
        Insert: {
          access_type: string
          created_at?: string
          fields?: string[] | null
          id?: string
          ip_address?: string | null
          project_id?: string | null
          reason?: string | null
          user_id?: string | null
          worker_id?: string | null
        }
        Update: {
          access_type?: string
          created_at?: string
          fields?: string[] | null
          id?: string
          ip_address?: string | null
          project_id?: string | null
          reason?: string | null
          user_id?: string | null
          worker_id?: string | null
        }
        Relationships: []
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
          default_role: Database["public"]["Enums"]["project_role"]
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
          default_role?: Database["public"]["Enums"]["project_role"]
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
          default_role?: Database["public"]["Enums"]["project_role"]
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
            foreignKeyName: "project_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "project_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_invites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_join_requests: {
        Row: {
          company_name: string | null
          created_at: string
          id: string
          project_id: string
          requested_role: Database["public"]["Enums"]["project_role"]
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
          requested_role?: Database["public"]["Enums"]["project_role"]
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
          requested_role?: Database["public"]["Enums"]["project_role"]
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
          {
            foreignKeyName: "project_join_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      project_members: {
        Row: {
          company: string | null
          company_id: string | null
          created_at: string
          id: string
          position_new: Database["public"]["Enums"]["project_position"] | null
          project_id: string
          role_new: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Insert: {
          company?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          position_new?: Database["public"]["Enums"]["project_position"] | null
          project_id: string
          role_new?: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Update: {
          company?: string | null
          company_id?: string | null
          created_at?: string
          id?: string
          position_new?: Database["public"]["Enums"]["project_position"] | null
          project_id?: string
          role_new?: Database["public"]["Enums"]["project_role"]
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
            foreignKeyName: "project_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      projects: {
        Row: {
          client: string | null
          contractor: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          gc_company_id: string | null
          gc_company_ids: string[]
          id: string
          is_deleted: boolean
          name: string
          period_end: string | null
          period_start: string | null
          site_address: string | null
          site_lat: number | null
          site_lng: number | null
          site_name: string
          status: string
          sub_company_ids: string[]
          subcontractors: string[] | null
          tags: string[] | null
          updated_at: string
        }
        Insert: {
          client?: string | null
          contractor?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          gc_company_id?: string | null
          gc_company_ids?: string[]
          id?: string
          is_deleted?: boolean
          name: string
          period_end?: string | null
          period_start?: string | null
          site_address?: string | null
          site_lat?: number | null
          site_lng?: number | null
          site_name?: string
          status?: string
          sub_company_ids?: string[]
          subcontractors?: string[] | null
          tags?: string[] | null
          updated_at?: string
        }
        Update: {
          client?: string | null
          contractor?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          gc_company_id?: string | null
          gc_company_ids?: string[]
          id?: string
          is_deleted?: boolean
          name?: string
          period_end?: string | null
          period_start?: string | null
          site_address?: string | null
          site_lat?: number | null
          site_lng?: number | null
          site_name?: string
          status?: string
          sub_company_ids?: string[]
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
          {
            foreignKeyName: "projects_gc_company_id_fkey"
            columns: ["gc_company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      rigging_plans: {
        Row: {
          boom_length: number | null
          boom_rotation_factor: number | null
          calculated_utilization: number | null
          chain_diameter_mm: number | null
          chain_leg_count: number | null
          chain_rated_load: number | null
          crane_capacity: number | null
          crane_model: string | null
          created_at: string
          equipment_name: string | null
          equipment_ok: string | null
          equipment_working_load: number | null
          ground_bearing_capacity: number | null
          ground_inspection_factor: number | null
          hook_weight: number | null
          hook_weight_min: number | null
          id: string
          input_method: string | null
          lifting_method: string | null
          load_description: string | null
          load_name_max: string | null
          load_name_min: string | null
          load_protrusion_factor: number | null
          load_weight: number
          load_weight_min: number | null
          notes: string | null
          outrigger_distance: number | null
          outrigger_setup: string | null
          rated_capacity: number | null
          round_sling_rated_load: number | null
          safety_factor: number | null
          safety_factor_cargo: number | null
          safety_factor_passenger: number | null
          shackle_angle_deg: number | null
          shackle_count: number | null
          shackle_diameter_mm: number | null
          shackle_inch: string | null
          shackle_ok: string | null
          shackle_qty: number | null
          shackle_safe_load: number | null
          shackle_weight_min: number | null
          shackle_weight_val: number | null
          shackle_working_load: number | null
          sling_angle_deg: number | null
          sling_belt_color: string | null
          sling_belt_rated_load: number | null
          sling_belt_width_mm: number | null
          sling_capacity: number | null
          sling_count: number | null
          sling_material_type: string | null
          sling_method: string | null
          sling_ok: string | null
          sling_rigging_weight: number | null
          sling_rigging_weight_min: number | null
          sling_safe_load: number | null
          sling_strand_count: number | null
          sling_type: string | null
          sling_working_load: number | null
          tension_per_leg: number | null
          total_weight_max: number | null
          total_weight_min: number | null
          travel_load_factor: number | null
          updated_at: string
          wind_speed_factor: number | null
          wind_speed_grade: string | null
          wire_breaking_load: number | null
          wire_diameter_inch: number | null
          wire_diameter_mm: number | null
          wire_lift_count: number | null
          wire_safe_load: number | null
          wire_safety_coefficient: number | null
          wire_terminal_method: string | null
          work_plan_id: string
          working_radius: number | null
        }
        Insert: {
          boom_length?: number | null
          boom_rotation_factor?: number | null
          calculated_utilization?: number | null
          chain_diameter_mm?: number | null
          chain_leg_count?: number | null
          chain_rated_load?: number | null
          crane_capacity?: number | null
          crane_model?: string | null
          created_at?: string
          equipment_name?: string | null
          equipment_ok?: string | null
          equipment_working_load?: number | null
          ground_bearing_capacity?: number | null
          ground_inspection_factor?: number | null
          hook_weight?: number | null
          hook_weight_min?: number | null
          id?: string
          input_method?: string | null
          lifting_method?: string | null
          load_description?: string | null
          load_name_max?: string | null
          load_name_min?: string | null
          load_protrusion_factor?: number | null
          load_weight?: number
          load_weight_min?: number | null
          notes?: string | null
          outrigger_distance?: number | null
          outrigger_setup?: string | null
          rated_capacity?: number | null
          round_sling_rated_load?: number | null
          safety_factor?: number | null
          safety_factor_cargo?: number | null
          safety_factor_passenger?: number | null
          shackle_angle_deg?: number | null
          shackle_count?: number | null
          shackle_diameter_mm?: number | null
          shackle_inch?: string | null
          shackle_ok?: string | null
          shackle_qty?: number | null
          shackle_safe_load?: number | null
          shackle_weight_min?: number | null
          shackle_weight_val?: number | null
          shackle_working_load?: number | null
          sling_angle_deg?: number | null
          sling_belt_color?: string | null
          sling_belt_rated_load?: number | null
          sling_belt_width_mm?: number | null
          sling_capacity?: number | null
          sling_count?: number | null
          sling_material_type?: string | null
          sling_method?: string | null
          sling_ok?: string | null
          sling_rigging_weight?: number | null
          sling_rigging_weight_min?: number | null
          sling_safe_load?: number | null
          sling_strand_count?: number | null
          sling_type?: string | null
          sling_working_load?: number | null
          tension_per_leg?: number | null
          total_weight_max?: number | null
          total_weight_min?: number | null
          travel_load_factor?: number | null
          updated_at?: string
          wind_speed_factor?: number | null
          wind_speed_grade?: string | null
          wire_breaking_load?: number | null
          wire_diameter_inch?: number | null
          wire_diameter_mm?: number | null
          wire_lift_count?: number | null
          wire_safe_load?: number | null
          wire_safety_coefficient?: number | null
          wire_terminal_method?: string | null
          work_plan_id: string
          working_radius?: number | null
        }
        Update: {
          boom_length?: number | null
          boom_rotation_factor?: number | null
          calculated_utilization?: number | null
          chain_diameter_mm?: number | null
          chain_leg_count?: number | null
          chain_rated_load?: number | null
          crane_capacity?: number | null
          crane_model?: string | null
          created_at?: string
          equipment_name?: string | null
          equipment_ok?: string | null
          equipment_working_load?: number | null
          ground_bearing_capacity?: number | null
          ground_inspection_factor?: number | null
          hook_weight?: number | null
          hook_weight_min?: number | null
          id?: string
          input_method?: string | null
          lifting_method?: string | null
          load_description?: string | null
          load_name_max?: string | null
          load_name_min?: string | null
          load_protrusion_factor?: number | null
          load_weight?: number
          load_weight_min?: number | null
          notes?: string | null
          outrigger_distance?: number | null
          outrigger_setup?: string | null
          rated_capacity?: number | null
          round_sling_rated_load?: number | null
          safety_factor?: number | null
          safety_factor_cargo?: number | null
          safety_factor_passenger?: number | null
          shackle_angle_deg?: number | null
          shackle_count?: number | null
          shackle_diameter_mm?: number | null
          shackle_inch?: string | null
          shackle_ok?: string | null
          shackle_qty?: number | null
          shackle_safe_load?: number | null
          shackle_weight_min?: number | null
          shackle_weight_val?: number | null
          shackle_working_load?: number | null
          sling_angle_deg?: number | null
          sling_belt_color?: string | null
          sling_belt_rated_load?: number | null
          sling_belt_width_mm?: number | null
          sling_capacity?: number | null
          sling_count?: number | null
          sling_material_type?: string | null
          sling_method?: string | null
          sling_ok?: string | null
          sling_rigging_weight?: number | null
          sling_rigging_weight_min?: number | null
          sling_safe_load?: number | null
          sling_strand_count?: number | null
          sling_type?: string | null
          sling_working_load?: number | null
          tension_per_leg?: number | null
          total_weight_max?: number | null
          total_weight_min?: number | null
          travel_load_factor?: number | null
          updated_at?: string
          wind_speed_factor?: number | null
          wind_speed_grade?: string | null
          wire_breaking_load?: number | null
          wire_diameter_inch?: number | null
          wire_diameter_mm?: number | null
          wire_lift_count?: number | null
          wire_safe_load?: number | null
          wire_safety_coefficient?: number | null
          wire_terminal_method?: string | null
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
            foreignKeyName: "risk_item_feedback_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
          auto_adjust_reason: string | null
          batch_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          department: string | null
          env_exceedance_source: string | null
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
          is_deleted: boolean
          is_excluded: boolean
          is_locked: boolean | null
          is_user_reviewed: boolean
          item_category: string
          legal_basis: string[] | null
          likelihood_grade: string
          linked_chemical_ids: string[] | null
          linked_env_factor_ids: string[] | null
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
          source_opinion_id: string | null
          source_type: string
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
          auto_adjust_reason?: string | null
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          department?: string | null
          env_exceedance_source?: string | null
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
          is_deleted?: boolean
          is_excluded?: boolean
          is_locked?: boolean | null
          is_user_reviewed?: boolean
          item_category?: string
          legal_basis?: string[] | null
          likelihood_grade?: string
          linked_chemical_ids?: string[] | null
          linked_env_factor_ids?: string[] | null
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
          source_opinion_id?: string | null
          source_type?: string
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
          auto_adjust_reason?: string | null
          batch_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          department?: string | null
          env_exceedance_source?: string | null
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
          is_deleted?: boolean
          is_excluded?: boolean
          is_locked?: boolean | null
          is_user_reviewed?: boolean
          item_category?: string
          legal_basis?: string[] | null
          likelihood_grade?: string
          linked_chemical_ids?: string[] | null
          linked_env_factor_ids?: string[] | null
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
          source_opinion_id?: string | null
          source_type?: string
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
            foreignKeyName: "risk_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
      risk_knowledge_base: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          embedding_summary: string | null
          equipment_tags: string[] | null
          id: string
          is_active: boolean
          legal_reference: string | null
          process_tags: string[] | null
          source_type: string
          title: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          embedding_summary?: string | null
          equipment_tags?: string[] | null
          id?: string
          is_active?: boolean
          legal_reference?: string | null
          process_tags?: string[] | null
          source_type: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          embedding_summary?: string | null
          equipment_tags?: string[] | null
          id?: string
          is_active?: boolean
          legal_reference?: string | null
          process_tags?: string[] | null
          source_type?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
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
      risk_user_corrections: {
        Row: {
          corrected: Json | null
          corrected_by: string
          created_at: string
          field_changed: string | null
          id: string
          original: Json | null
          process_name: string | null
          project_id: string
        }
        Insert: {
          corrected?: Json | null
          corrected_by: string
          created_at?: string
          field_changed?: string | null
          id?: string
          original?: Json | null
          process_name?: string | null
          project_id: string
        }
        Update: {
          corrected?: Json | null
          corrected_by?: string
          created_at?: string
          field_changed?: string | null
          id?: string
          original?: Json | null
          process_name?: string | null
          project_id?: string
        }
        Relationships: []
      }
      safety_appointments: {
        Row: {
          appointed_at: string
          authority_doc_no: string | null
          company_id: string | null
          created_at: string
          ended_at: string | null
          evidence_url: string | null
          full_name: string
          id: string
          is_deleted: boolean
          project_id: string
          reason: string | null
          reported_to_authority_at: string | null
          role_type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          appointed_at: string
          authority_doc_no?: string | null
          company_id?: string | null
          created_at?: string
          ended_at?: string | null
          evidence_url?: string | null
          full_name: string
          id?: string
          is_deleted?: boolean
          project_id: string
          reason?: string | null
          reported_to_authority_at?: string | null
          role_type: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          appointed_at?: string
          authority_doc_no?: string | null
          company_id?: string | null
          created_at?: string
          ended_at?: string | null
          evidence_url?: string | null
          full_name?: string
          id?: string
          is_deleted?: boolean
          project_id?: string
          reason?: string | null
          reported_to_authority_at?: string | null
          role_type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_appointments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_appointments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "safety_appointments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_appointments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      safety_cost_approval_steps: {
        Row: {
          approved_at: string | null
          approver_id: string | null
          approver_name: string
          comment: string
          company_id: string
          company_name: string
          construction_id: string
          created_at: string
          id: string
          position: string
          project_id: string
          report_id: string
          status: string
          step_label: string
          step_order: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approver_id?: string | null
          approver_name?: string
          comment?: string
          company_id: string
          company_name?: string
          construction_id: string
          created_at?: string
          id?: string
          position?: string
          project_id: string
          report_id: string
          status?: string
          step_label?: string
          step_order?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approver_id?: string | null
          approver_name?: string
          comment?: string
          company_id?: string
          company_name?: string
          construction_id?: string
          created_at?: string
          id?: string
          position?: string
          project_id?: string
          report_id?: string
          status?: string
          step_label?: string
          step_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_cost_approval_steps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_approval_steps_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "safety_cost_approval_steps_construction_id_fkey"
            columns: ["construction_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_constructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_approval_steps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_approval_steps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "safety_cost_approval_steps_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_monthly_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_cost_audit_logs: {
        Row: {
          action: string
          after_data: Json
          before_data: Json
          company_id: string | null
          construction_id: string | null
          created_at: string
          id: string
          item_id: string | null
          project_id: string
          reason: string
          report_id: string | null
          target_id: string | null
          target_type: string
          user_id: string | null
          user_name: string
        }
        Insert: {
          action: string
          after_data?: Json
          before_data?: Json
          company_id?: string | null
          construction_id?: string | null
          created_at?: string
          id?: string
          item_id?: string | null
          project_id: string
          reason?: string
          report_id?: string | null
          target_id?: string | null
          target_type?: string
          user_id?: string | null
          user_name?: string
        }
        Update: {
          action?: string
          after_data?: Json
          before_data?: Json
          company_id?: string | null
          construction_id?: string | null
          created_at?: string
          id?: string
          item_id?: string | null
          project_id?: string
          reason?: string
          report_id?: string | null
          target_id?: string | null
          target_type?: string
          user_id?: string | null
          user_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_cost_audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_audit_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "safety_cost_audit_logs_construction_id_fkey"
            columns: ["construction_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_constructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_audit_logs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_audit_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "safety_cost_audit_logs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_monthly_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_cost_constructions: {
        Row: {
          basis_files: Json
          company_id: string
          construction_amount: number
          construction_name: string
          construction_type: string
          created_at: string
          created_by: string | null
          id: string
          notes: string
          project_id: string
          safety_cost_total: number
          status: string
          updated_at: string
        }
        Insert: {
          basis_files?: Json
          company_id: string
          construction_amount?: number
          construction_name?: string
          construction_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string
          project_id: string
          safety_cost_total?: number
          status?: string
          updated_at?: string
        }
        Update: {
          basis_files?: Json
          company_id?: string
          construction_amount?: number
          construction_name?: string
          construction_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string
          project_id?: string
          safety_cost_total?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_cost_constructions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_constructions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "safety_cost_constructions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_constructions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      safety_cost_evidence_files: {
        Row: {
          company_id: string
          construction_id: string
          created_at: string
          evidence_kind: string
          file_hash: string
          file_name: string
          file_path: string
          file_size: number
          file_url: string
          id: string
          item_id: string | null
          mime_type: string
          project_id: string
          report_id: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          company_id: string
          construction_id: string
          created_at?: string
          evidence_kind?: string
          file_hash?: string
          file_name?: string
          file_path?: string
          file_size?: number
          file_url?: string
          id?: string
          item_id?: string | null
          mime_type?: string
          project_id: string
          report_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          company_id?: string
          construction_id?: string
          created_at?: string
          evidence_kind?: string
          file_hash?: string
          file_name?: string
          file_path?: string
          file_size?: number
          file_url?: string
          id?: string
          item_id?: string | null
          mime_type?: string
          project_id?: string
          report_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_cost_evidence_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_evidence_files_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "safety_cost_evidence_files_construction_id_fkey"
            columns: ["construction_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_constructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_evidence_files_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_evidence_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_evidence_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "safety_cost_evidence_files_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_monthly_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_cost_items: {
        Row: {
          ai_confidence: number | null
          ai_reason: string
          amount: number
          category_code: string
          category_name: string
          classification_status: string
          company_id: string
          construction_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_deleted: boolean
          item_name: string
          legal_basis: string
          maker: string
          project_id: string
          quantity: number
          report_id: string
          review_comment: string
          sort_order: number
          source_file_id: string | null
          specification: string
          supplier_name: string
          supply_amount: number
          transaction_date: string | null
          unit: string
          unit_price: number
          updated_at: string
          usage_date: string | null
          vat_amount: number
        }
        Insert: {
          ai_confidence?: number | null
          ai_reason?: string
          amount?: number
          category_code?: string
          category_name?: string
          classification_status?: string
          company_id: string
          construction_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
          item_name?: string
          legal_basis?: string
          maker?: string
          project_id: string
          quantity?: number
          report_id: string
          review_comment?: string
          sort_order?: number
          source_file_id?: string | null
          specification?: string
          supplier_name?: string
          supply_amount?: number
          transaction_date?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
          usage_date?: string | null
          vat_amount?: number
        }
        Update: {
          ai_confidence?: number | null
          ai_reason?: string
          amount?: number
          category_code?: string
          category_name?: string
          classification_status?: string
          company_id?: string
          construction_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
          item_name?: string
          legal_basis?: string
          maker?: string
          project_id?: string
          quantity?: number
          report_id?: string
          review_comment?: string
          sort_order?: number
          source_file_id?: string | null
          specification?: string
          supplier_name?: string
          supply_amount?: number
          transaction_date?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
          usage_date?: string | null
          vat_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "safety_cost_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "safety_cost_items_construction_id_fkey"
            columns: ["construction_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_constructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "safety_cost_items_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_monthly_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_cost_monthly_reports: {
        Row: {
          approval_version: number
          approved_at: string | null
          approved_by: string | null
          company_id: string
          construction_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_deleted: boolean
          project_id: string
          rejected_reason: string
          report_month: string
          report_total: number
          status: string
          submitted_at: string | null
          submitted_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          approval_version?: number
          approved_at?: string | null
          approved_by?: string | null
          company_id: string
          construction_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
          project_id: string
          rejected_reason?: string
          report_month: string
          report_total?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          approval_version?: number
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          construction_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_deleted?: boolean
          project_id?: string
          rejected_reason?: string
          report_month?: string
          report_total?: number
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_cost_monthly_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_monthly_reports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "safety_cost_monthly_reports_construction_id_fkey"
            columns: ["construction_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_constructions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_monthly_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_cost_monthly_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      safety_cost_violations: {
        Row: {
          actual_amount: number | null
          category_code: string | null
          company_id: string | null
          created_at: string
          detail: string | null
          expected_amount: number | null
          id: string
          is_deleted: boolean | null
          legal_basis: string | null
          project_id: string
          report_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          updated_at: string
          violation_code: string
        }
        Insert: {
          actual_amount?: number | null
          category_code?: string | null
          company_id?: string | null
          created_at?: string
          detail?: string | null
          expected_amount?: number | null
          id?: string
          is_deleted?: boolean | null
          legal_basis?: string | null
          project_id: string
          report_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          updated_at?: string
          violation_code: string
        }
        Update: {
          actual_amount?: number | null
          category_code?: string | null
          company_id?: string | null
          created_at?: string
          detail?: string | null
          expected_amount?: number | null
          id?: string
          is_deleted?: boolean | null
          legal_basis?: string | null
          project_id?: string
          report_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          updated_at?: string
          violation_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_cost_violations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "safety_cost_monthly_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_education_materials: {
        Row: {
          accident_cases: Json
          auto_generated: boolean
          category: string | null
          company_id: string | null
          completion_count: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          generated_by: string | null
          id: string
          is_deleted: boolean
          key_hazards: Json
          last_completed_at: string | null
          ppe_requirements: Json
          prohibited_actions: Json
          project_id: string
          run_id: string | null
          safety_measures: Json
          tbm_summary: string
          title: string
          updated_at: string
          version_number: number
          work_overview: string
          work_plan_id: string | null
        }
        Insert: {
          accident_cases?: Json
          auto_generated?: boolean
          category?: string | null
          company_id?: string | null
          completion_count?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          generated_by?: string | null
          id?: string
          is_deleted?: boolean
          key_hazards?: Json
          last_completed_at?: string | null
          ppe_requirements?: Json
          prohibited_actions?: Json
          project_id: string
          run_id?: string | null
          safety_measures?: Json
          tbm_summary?: string
          title?: string
          updated_at?: string
          version_number?: number
          work_overview?: string
          work_plan_id?: string | null
        }
        Update: {
          accident_cases?: Json
          auto_generated?: boolean
          category?: string | null
          company_id?: string | null
          completion_count?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          generated_by?: string | null
          id?: string
          is_deleted?: boolean
          key_hazards?: Json
          last_completed_at?: string | null
          ppe_requirements?: Json
          prohibited_actions?: Json
          project_id?: string
          run_id?: string | null
          safety_measures?: Json
          tbm_summary?: string
          title?: string
          updated_at?: string
          version_number?: number
          work_overview?: string
          work_plan_id?: string | null
        }
        Relationships: []
      }
      safety_inspection_actions: {
        Row: {
          assignee_id: string | null
          assignee_name: string
          completed_at: string | null
          completed_by: string | null
          completion_note: string
          created_at: string
          due_date: string | null
          evidence_photos: Json
          id: string
          inspection_id: string
          issue: string
          item_id: string | null
          project_id: string
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          assignee_name?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string
          created_at?: string
          due_date?: string | null
          evidence_photos?: Json
          id?: string
          inspection_id: string
          issue?: string
          item_id?: string | null
          project_id: string
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          assignee_name?: string
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string
          created_at?: string
          due_date?: string | null
          evidence_photos?: Json
          id?: string
          inspection_id?: string
          issue?: string
          item_id?: string | null
          project_id?: string
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_inspection_actions_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "safety_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_inspection_actions_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "safety_inspection_items"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_inspection_items: {
        Row: {
          checklist_code: string
          created_at: string
          id: string
          inspection_id: string
          label: string
          legal_basis: string
          note: string
          photos: Json
          result: string
          sort_order: number
        }
        Insert: {
          checklist_code?: string
          created_at?: string
          id?: string
          inspection_id: string
          label: string
          legal_basis?: string
          note?: string
          photos?: Json
          result?: string
          sort_order?: number
        }
        Update: {
          checklist_code?: string
          created_at?: string
          id?: string
          inspection_id?: string
          label?: string
          legal_basis?: string
          note?: string
          photos?: Json
          result?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "safety_inspection_items_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "safety_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_inspections: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          inspected_at: string
          inspection_category: string | null
          inspection_type: string
          inspector_id: string | null
          inspector_name: string
          is_deleted: boolean
          legal_frequency: string | null
          location: string
          participating_company_ids: string[] | null
          process_category: string
          project_id: string
          status: string
          summary: string
          updated_at: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          inspected_at?: string
          inspection_category?: string | null
          inspection_type?: string
          inspector_id?: string | null
          inspector_name?: string
          is_deleted?: boolean
          legal_frequency?: string | null
          location?: string
          participating_company_ids?: string[] | null
          process_category?: string
          project_id: string
          status?: string
          summary?: string
          updated_at?: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          inspected_at?: string
          inspection_category?: string | null
          inspection_type?: string
          inspector_id?: string | null
          inspector_name?: string
          is_deleted?: boolean
          legal_frequency?: string | null
          location?: string
          participating_company_ids?: string[] | null
          process_category?: string
          project_id?: string
          status?: string
          summary?: string
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
          {
            foreignKeyName: "schedule_uploads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
      site_maps: {
        Row: {
          created_at: string
          created_by: string | null
          geo_anchor_nw_lat: number | null
          geo_anchor_nw_lng: number | null
          geo_anchor_se_lat: number | null
          geo_anchor_se_lng: number | null
          height_m: number | null
          height_px: number | null
          id: string
          image_url: string | null
          is_active: boolean
          is_deleted: boolean
          name: string
          project_id: string
          updated_at: string
          width_m: number | null
          width_px: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          geo_anchor_nw_lat?: number | null
          geo_anchor_nw_lng?: number | null
          geo_anchor_se_lat?: number | null
          geo_anchor_se_lng?: number | null
          height_m?: number | null
          height_px?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_deleted?: boolean
          name: string
          project_id: string
          updated_at?: string
          width_m?: number | null
          width_px?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          geo_anchor_nw_lat?: number | null
          geo_anchor_nw_lng?: number | null
          geo_anchor_se_lat?: number | null
          geo_anchor_se_lng?: number | null
          height_m?: number | null
          height_px?: number | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          project_id?: string
          updated_at?: string
          width_m?: number | null
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "site_maps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_maps_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      site_zones: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          geo_polygon: Json | null
          id: string
          is_deleted: boolean
          name: string
          polygon: Json
          project_id: string
          site_map_id: string
          updated_at: string
          wifi_fingerprint: Json | null
          zone_type: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          geo_polygon?: Json | null
          id?: string
          is_deleted?: boolean
          name: string
          polygon: Json
          project_id: string
          site_map_id: string
          updated_at?: string
          wifi_fingerprint?: Json | null
          zone_type?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          geo_polygon?: Json | null
          id?: string
          is_deleted?: boolean
          name?: string
          polygon?: Json
          project_id?: string
          site_map_id?: string
          updated_at?: string
          wifi_fingerprint?: Json | null
          zone_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_zones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_zones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "site_zones_site_map_id_fkey"
            columns: ["site_map_id"]
            isOneToOne: false
            referencedRelation: "site_maps"
            referencedColumns: ["id"]
          },
        ]
      }
      special_health_targets: {
        Row: {
          company_id: string | null
          created_at: string
          created_by: string | null
          exposure_started_at: string | null
          hazard_type: string
          id: string
          is_deleted: boolean | null
          legal_basis: string | null
          next_checkup_due: string | null
          notes: string | null
          project_id: string
          required_checkup_interval_months: number | null
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          exposure_started_at?: string | null
          hazard_type: string
          id?: string
          is_deleted?: boolean | null
          legal_basis?: string | null
          next_checkup_due?: string | null
          notes?: string | null
          project_id: string
          required_checkup_interval_months?: number | null
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          exposure_started_at?: string | null
          hazard_type?: string
          id?: string
          is_deleted?: boolean | null
          legal_basis?: string | null
          next_checkup_due?: string | null
          notes?: string | null
          project_id?: string
          required_checkup_interval_months?: number | null
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "special_health_targets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_health_targets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "special_health_targets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "special_health_targets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "special_health_targets_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
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
      system_test_artifacts: {
        Row: {
          created_at: string
          id: string
          kind: string
          ref_id: string
          ref_table: string
          run_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          ref_id: string
          ref_table: string
          run_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          ref_id?: string
          ref_table?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_test_artifacts_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_test_results: {
        Row: {
          created_at: string
          details: Json | null
          duration_ms: number | null
          error_location: string | null
          id: string
          pass_fail: string
          run_id: string
          scenario_key: string
          score: number | null
          step_key: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          error_location?: string | null
          id?: string
          pass_fail: string
          run_id: string
          scenario_key: string
          score?: number | null
          step_key: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          duration_ms?: number | null
          error_location?: string | null
          id?: string
          pass_fail?: string
          run_id?: string
          scenario_key?: string
          score?: number | null
          step_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_test_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "system_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      system_test_runs: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          scope: string
          started_at: string
          started_by: string
          status: string
          summary: Json | null
          total_score: number | null
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          scope?: string
          started_at?: string
          started_by: string
          status?: string
          summary?: Json | null
          total_score?: number | null
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          scope?: string
          started_at?: string
          started_by?: string
          status?: string
          summary?: Json | null
          total_score?: number | null
        }
        Relationships: []
      }
      tbm_participations: {
        Row: {
          briefing_confirmed: boolean
          company_name: string
          created_at: string
          id: string
          ip_hash: string
          participated_at: string
          signature_data: string
          tbm_session_id: string
          user_agent: string
          worker_name: string
          worker_phone: string
        }
        Insert: {
          briefing_confirmed?: boolean
          company_name?: string
          created_at?: string
          id?: string
          ip_hash?: string
          participated_at?: string
          signature_data?: string
          tbm_session_id: string
          user_agent?: string
          worker_name: string
          worker_phone: string
        }
        Update: {
          briefing_confirmed?: boolean
          company_name?: string
          created_at?: string
          id?: string
          ip_hash?: string
          participated_at?: string
          signature_data?: string
          tbm_session_id?: string
          user_agent?: string
          worker_name?: string
          worker_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "tbm_participations_tbm_session_id_fkey"
            columns: ["tbm_session_id"]
            isOneToOne: false
            referencedRelation: "tbm_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      tbm_sessions: {
        Row: {
          briefing_risks: Json
          briefing_summary: string
          company_id: string | null
          company_name: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          leader_name: string
          location: string
          process_category: string | null
          prohibited_actions: string
          project_id: string
          qr_token: string
          run_id: string | null
          special_notes: string
          tbm_date: string
          title: string
          updated_at: string
          work_content: string
          work_plan_id: string | null
          work_steps: string
        }
        Insert: {
          briefing_risks?: Json
          briefing_summary?: string
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          leader_name?: string
          location?: string
          process_category?: string | null
          prohibited_actions?: string
          project_id: string
          qr_token?: string
          run_id?: string | null
          special_notes?: string
          tbm_date?: string
          title?: string
          updated_at?: string
          work_content?: string
          work_plan_id?: string | null
          work_steps?: string
        }
        Update: {
          briefing_risks?: Json
          briefing_summary?: string
          company_id?: string | null
          company_name?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          leader_name?: string
          location?: string
          process_category?: string | null
          prohibited_actions?: string
          project_id?: string
          qr_token?: string
          run_id?: string | null
          special_notes?: string
          tbm_date?: string
          title?: string
          updated_at?: string
          work_content?: string
          work_plan_id?: string | null
          work_steps?: string
        }
        Relationships: []
      }
      todo_items: {
        Row: {
          category: string | null
          company_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          description: string | null
          due_date: string
          frequency: string
          id: string
          is_deleted: boolean
          legal_duty_id: string | null
          project_id: string
          source_id: string | null
          source_table: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          company_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          description?: string | null
          due_date: string
          frequency?: string
          id?: string
          is_deleted?: boolean
          legal_duty_id?: string | null
          project_id: string
          source_id?: string | null
          source_table?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          company_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          description?: string | null
          due_date?: string
          frequency?: string
          id?: string
          is_deleted?: boolean
          legal_duty_id?: string | null
          project_id?: string
          source_id?: string | null
          source_table?: string | null
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
            foreignKeyName: "todo_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
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
          {
            foreignKeyName: "todo_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["global_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["global_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["global_role"]
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
            foreignKeyName: "validation_results_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
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
      weather_cache: {
        Row: {
          cache_type: string
          created_at: string
          data: Json
          fetched_at: string
          id: string
          project_id: string
        }
        Insert: {
          cache_type?: string
          created_at?: string
          data?: Json
          fetched_at?: string
          id?: string
          project_id: string
        }
        Update: {
          cache_type?: string
          created_at?: string
          data?: Json
          fetched_at?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weather_cache_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weather_cache_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      wifi_fingerprint_samples: {
        Row: {
          bssid: string
          collected_by_user_id: string | null
          created_at: string
          id: string
          project_id: string
          rssi: number
          sample_at: string
          ssid: string | null
          zone_id: string
        }
        Insert: {
          bssid: string
          collected_by_user_id?: string | null
          created_at?: string
          id?: string
          project_id: string
          rssi: number
          sample_at?: string
          ssid?: string | null
          zone_id: string
        }
        Update: {
          bssid?: string
          collected_by_user_id?: string | null
          created_at?: string
          id?: string
          project_id?: string
          rssi?: number
          sample_at?: string
          ssid?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wifi_fingerprint_samples_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wifi_fingerprint_samples_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "wifi_fingerprint_samples_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "site_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      work_env_factors: {
        Row: {
          cas_no: string | null
          category: Database["public"]["Enums"]["env_factor_category"]
          created_at: string | null
          created_by: string | null
          exposure_limit_unit: string | null
          exposure_limit_value: number | null
          id: string
          is_deleted: boolean | null
          name: string
          notes: string | null
          project_id: string
          updated_at: string | null
        }
        Insert: {
          cas_no?: string | null
          category: Database["public"]["Enums"]["env_factor_category"]
          created_at?: string | null
          created_by?: string | null
          exposure_limit_unit?: string | null
          exposure_limit_value?: number | null
          id?: string
          is_deleted?: boolean | null
          name: string
          notes?: string | null
          project_id: string
          updated_at?: string | null
        }
        Update: {
          cas_no?: string | null
          category?: Database["public"]["Enums"]["env_factor_category"]
          created_at?: string | null
          created_by?: string | null
          exposure_limit_unit?: string | null
          exposure_limit_value?: number | null
          id?: string
          is_deleted?: boolean | null
          name?: string
          notes?: string | null
          project_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_env_factors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_env_factors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      work_env_measurements: {
        Row: {
          action_required: boolean | null
          action_summary: string | null
          agency: string | null
          company_id: string | null
          created_at: string | null
          created_by: string | null
          exposure_limit: number | null
          factor_id: string | null
          factor_name: string | null
          id: string
          is_deleted: boolean | null
          is_exceeded: boolean | null
          location: string | null
          measure_date: string
          measured_value: number | null
          next_due_date: string | null
          project_id: string
          report_url: string | null
          round: string
          unit: string | null
          updated_at: string | null
        }
        Insert: {
          action_required?: boolean | null
          action_summary?: string | null
          agency?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          exposure_limit?: number | null
          factor_id?: string | null
          factor_name?: string | null
          id?: string
          is_deleted?: boolean | null
          is_exceeded?: boolean | null
          location?: string | null
          measure_date: string
          measured_value?: number | null
          next_due_date?: string | null
          project_id: string
          report_url?: string | null
          round: string
          unit?: string | null
          updated_at?: string | null
        }
        Update: {
          action_required?: boolean | null
          action_summary?: string | null
          agency?: string | null
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          exposure_limit?: number | null
          factor_id?: string | null
          factor_name?: string | null
          id?: string
          is_deleted?: boolean | null
          is_exceeded?: boolean | null
          location?: string | null
          measure_date?: string
          measured_value?: number | null
          next_due_date?: string | null
          project_id?: string
          report_url?: string | null
          round?: string
          unit?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_env_measurements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_env_measurements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "work_env_measurements_factor_id_fkey"
            columns: ["factor_id"]
            isOneToOne: false
            referencedRelation: "work_env_factors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_env_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_env_measurements_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      work_permit_workers: {
        Row: {
          created_at: string
          id: string
          notification_status: string
          notified_at: string | null
          project_id: string
          work_permit_id: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notification_status?: string
          notified_at?: string | null
          project_id: string
          work_permit_id: string
          worker_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notification_status?: string
          notified_at?: string | null
          project_id?: string
          work_permit_id?: string
          worker_id?: string
        }
        Relationships: []
      }
      work_permits: {
        Row: {
          approval_comment: string | null
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string
          assessment_run_id: string | null
          contractor_company: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          dig_company: string
          extension_until: string | null
          form_data: Json
          gate_check_result: Json
          id: string
          is_deleted: boolean
          location: string
          permit_date: string
          permit_type: string
          personnel_count: number
          project_id: string
          rejection_reason: string
          review_comment: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          signatures: Json
          status: string
          submitted_at: string | null
          submitted_by: string | null
          submitted_by_name: string | null
          tbm_session_id: string | null
          updated_at: string
          weather_check_passed: boolean
          weather_snapshot: Json
          work_description: string
          work_end_at: string | null
          work_name: string
          work_plan_id: string | null
          work_start_at: string | null
        }
        Insert: {
          approval_comment?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string
          assessment_run_id?: string | null
          contractor_company?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          dig_company?: string
          extension_until?: string | null
          form_data?: Json
          gate_check_result?: Json
          id?: string
          is_deleted?: boolean
          location?: string
          permit_date?: string
          permit_type?: string
          personnel_count?: number
          project_id: string
          rejection_reason?: string
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          signatures?: Json
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          submitted_by_name?: string | null
          tbm_session_id?: string | null
          updated_at?: string
          weather_check_passed?: boolean
          weather_snapshot?: Json
          work_description?: string
          work_end_at?: string | null
          work_name?: string
          work_plan_id?: string | null
          work_start_at?: string | null
        }
        Update: {
          approval_comment?: string | null
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string
          assessment_run_id?: string | null
          contractor_company?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          dig_company?: string
          extension_until?: string | null
          form_data?: Json
          gate_check_result?: Json
          id?: string
          is_deleted?: boolean
          location?: string
          permit_date?: string
          permit_type?: string
          personnel_count?: number
          project_id?: string
          rejection_reason?: string
          review_comment?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          signatures?: Json
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          submitted_by_name?: string | null
          tbm_session_id?: string | null
          updated_at?: string
          weather_check_passed?: boolean
          weather_snapshot?: Json
          work_description?: string
          work_end_at?: string | null
          work_name?: string
          work_plan_id?: string | null
          work_start_at?: string | null
        }
        Relationships: []
      }
      work_plan_attachments: {
        Row: {
          attachment_key: string
          calc_ref: string | null
          category: string
          company_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          file_path: string | null
          file_size: number | null
          file_url: string | null
          id: string
          is_deleted: boolean
          is_mandatory: boolean
          locked: boolean
          mime_type: string | null
          name: string
          project_id: string
          retention_until: string | null
          source_ref_id: string | null
          source_table: string | null
          source_type: string
          updated_at: string
          uploaded_by: string | null
          work_plan_id: string
        }
        Insert: {
          attachment_key: string
          calc_ref?: string | null
          category: string
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          file_path?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          is_deleted?: boolean
          is_mandatory?: boolean
          locked?: boolean
          mime_type?: string | null
          name: string
          project_id: string
          retention_until?: string | null
          source_ref_id?: string | null
          source_table?: string | null
          source_type?: string
          updated_at?: string
          uploaded_by?: string | null
          work_plan_id: string
        }
        Update: {
          attachment_key?: string
          calc_ref?: string | null
          category?: string
          company_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          file_path?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          is_deleted?: boolean
          is_mandatory?: boolean
          locked?: boolean
          mime_type?: string | null
          name?: string
          project_id?: string
          retention_until?: string | null
          source_ref_id?: string | null
          source_table?: string | null
          source_type?: string
          updated_at?: string
          uploaded_by?: string | null
          work_plan_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_plan_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_plan_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "work_plan_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_plan_attachments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "work_plan_attachments_work_plan_id_fkey"
            columns: ["work_plan_id"]
            isOneToOne: false
            referencedRelation: "work_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      work_plans: {
        Row: {
          assessment_run_id: string | null
          attachments: Json
          auto_education_enabled: boolean
          company_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_reason: string | null
          end_date: string | null
          id: string
          is_deleted: boolean
          parent_id: string | null
          project_id: string
          sections: Json
          start_date: string | null
          status: string
          title: string
          updated_at: string
          version: number
          work_type: string
        }
        Insert: {
          assessment_run_id?: string | null
          attachments?: Json
          auto_education_enabled?: boolean
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          end_date?: string | null
          id?: string
          is_deleted?: boolean
          parent_id?: string | null
          project_id: string
          sections?: Json
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: number
          work_type: string
        }
        Update: {
          assessment_run_id?: string | null
          attachments?: Json
          auto_education_enabled?: boolean
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_reason?: string | null
          end_date?: string | null
          id?: string
          is_deleted?: boolean
          parent_id?: string | null
          project_id?: string
          sections?: Json
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
          version?: number
          work_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_plans_assessment_run_id_fkey"
            columns: ["assessment_run_id"]
            isOneToOne: false
            referencedRelation: "assessment_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "work_plans_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "work_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_plans_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      work_stop_requests: {
        Row: {
          created_at: string
          hazard_description: string
          id: string
          location: string | null
          photo_url: string | null
          project_id: string
          reporter_name: string
          resolution_note: string | null
          resumed_at: string | null
          resumed_by: string | null
          retaliation_flag: boolean
          status: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          created_at?: string
          hazard_description: string
          id?: string
          location?: string | null
          photo_url?: string | null
          project_id: string
          reporter_name: string
          resolution_note?: string | null
          resumed_at?: string | null
          resumed_by?: string | null
          retaliation_flag?: boolean
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          created_at?: string
          hazard_description?: string
          id?: string
          location?: string | null
          photo_url?: string | null
          project_id?: string
          reporter_name?: string
          resolution_note?: string | null
          resumed_at?: string | null
          resumed_by?: string | null
          retaliation_flag?: boolean
          status?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_stop_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_stop_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "work_stop_requests_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_daily_health_logs: {
        Row: {
          body_temp: number | null
          bp_diastolic: number | null
          bp_systolic: number | null
          created_at: string
          fit_to_work: boolean
          id: string
          is_deleted: boolean
          log_date: string
          note: string | null
          project_id: string
          reason: string
          signature_data: string | null
          sleep_hours: number | null
          symptoms: Json
          updated_at: string
          worker_id: string
        }
        Insert: {
          body_temp?: number | null
          bp_diastolic?: number | null
          bp_systolic?: number | null
          created_at?: string
          fit_to_work?: boolean
          id?: string
          is_deleted?: boolean
          log_date?: string
          note?: string | null
          project_id: string
          reason?: string
          signature_data?: string | null
          sleep_hours?: number | null
          symptoms?: Json
          updated_at?: string
          worker_id: string
        }
        Update: {
          body_temp?: number | null
          bp_diastolic?: number | null
          bp_systolic?: number | null
          created_at?: string
          fit_to_work?: boolean
          id?: string
          is_deleted?: boolean
          log_date?: string
          note?: string | null
          project_id?: string
          reason?: string
          signature_data?: string | null
          sleep_hours?: number | null
          symptoms?: Json
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_daily_health_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_daily_health_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "worker_daily_health_logs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_daily_qr: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          project_id: string
          qr_token: string
          used_for_entry: boolean
          used_for_exit: boolean
          work_date: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          project_id: string
          qr_token: string
          used_for_entry?: boolean
          used_for_exit?: boolean
          work_date: string
          worker_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          project_id?: string
          qr_token?: string
          used_for_entry?: boolean
          used_for_exit?: boolean
          work_date?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_daily_qr_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_daily_qr_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "worker_daily_qr_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_education_records: {
        Row: {
          company_id: string | null
          completed_at: string
          course_name: string
          created_at: string
          created_by: string | null
          education_type: string
          evidence_url: string | null
          hours: number
          id: string
          instructor: string | null
          is_deleted: boolean
          next_due_at: string | null
          notes: string | null
          project_id: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          company_id?: string | null
          completed_at: string
          course_name: string
          created_at?: string
          created_by?: string | null
          education_type: string
          evidence_url?: string | null
          hours?: number
          id?: string
          instructor?: string | null
          is_deleted?: boolean
          next_due_at?: string | null
          notes?: string | null
          project_id: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          company_id?: string | null
          completed_at?: string
          course_name?: string
          created_at?: string
          created_by?: string | null
          education_type?: string
          evidence_url?: string | null
          hours?: number
          id?: string
          instructor?: string | null
          is_deleted?: boolean
          next_due_at?: string | null
          notes?: string | null
          project_id?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_education_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_education_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "worker_education_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_education_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "worker_education_records_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_entry_logs: {
        Row: {
          company_daily_qr_id: string | null
          created_at: string
          daily_qr_id: string | null
          education_confirmed: boolean
          entry_at: string
          entry_method: string
          entry_signature_data: string | null
          exit_at: string | null
          exit_signature_data: string | null
          health_warning_items: Json | null
          health_warning_shown: boolean | null
          id: string
          no_accident_confirmed: boolean
          project_id: string
          risk_assessment_confirmed: boolean
          tbm_confirmed: boolean
          work_permit_id: string | null
          worker_id: string
        }
        Insert: {
          company_daily_qr_id?: string | null
          created_at?: string
          daily_qr_id?: string | null
          education_confirmed?: boolean
          entry_at?: string
          entry_method?: string
          entry_signature_data?: string | null
          exit_at?: string | null
          exit_signature_data?: string | null
          health_warning_items?: Json | null
          health_warning_shown?: boolean | null
          id?: string
          no_accident_confirmed?: boolean
          project_id: string
          risk_assessment_confirmed?: boolean
          tbm_confirmed?: boolean
          work_permit_id?: string | null
          worker_id: string
        }
        Update: {
          company_daily_qr_id?: string | null
          created_at?: string
          daily_qr_id?: string | null
          education_confirmed?: boolean
          entry_at?: string
          entry_method?: string
          entry_signature_data?: string | null
          exit_at?: string | null
          exit_signature_data?: string | null
          health_warning_items?: Json | null
          health_warning_shown?: boolean | null
          id?: string
          no_accident_confirmed?: boolean
          project_id?: string
          risk_assessment_confirmed?: boolean
          tbm_confirmed?: boolean
          work_permit_id?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_entry_logs_company_daily_qr_id_fkey"
            columns: ["company_daily_qr_id"]
            isOneToOne: false
            referencedRelation: "company_daily_qr"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_entry_logs_daily_qr_id_fkey"
            columns: ["daily_qr_id"]
            isOneToOne: false
            referencedRelation: "worker_daily_qr"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_legal_education_mapping: {
        Row: {
          created_at: string
          education_type: string
          first_due_days: number
          id: string
          interval_months: number
          is_deleted: boolean
          is_system_default: boolean
          job_type: string
          legal_basis: string | null
          project_id: string | null
          required_hours: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          education_type: string
          first_due_days?: number
          id?: string
          interval_months?: number
          is_deleted?: boolean
          is_system_default?: boolean
          job_type: string
          legal_basis?: string | null
          project_id?: string | null
          required_hours?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          education_type?: string
          first_due_days?: number
          id?: string
          interval_months?: number
          is_deleted?: boolean
          is_system_default?: boolean
          job_type?: string
          legal_basis?: string | null
          project_id?: string | null
          required_hours?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_legal_education_mapping_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_legal_education_mapping_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
        ]
      }
      worker_opinions: {
        Row: {
          analysis_result: Json | null
          analysis_status: string
          created_at: string
          created_by: string | null
          id: string
          opinion_text: string
          participated_at: string | null
          project_id: string
          run_id: string
          signature_url: string | null
          updated_at: string
          worker_company: string
          worker_name: string
          worker_position: string
        }
        Insert: {
          analysis_result?: Json | null
          analysis_status?: string
          created_at?: string
          created_by?: string | null
          id?: string
          opinion_text?: string
          participated_at?: string | null
          project_id: string
          run_id: string
          signature_url?: string | null
          updated_at?: string
          worker_company?: string
          worker_name?: string
          worker_position?: string
        }
        Update: {
          analysis_result?: Json | null
          analysis_status?: string
          created_at?: string
          created_by?: string | null
          id?: string
          opinion_text?: string
          participated_at?: string | null
          project_id?: string
          run_id?: string
          signature_url?: string | null
          updated_at?: string
          worker_company?: string
          worker_name?: string
          worker_position?: string
        }
        Relationships: []
      }
      worker_phone_otps: {
        Row: {
          attempts: number
          code: string
          created_at: string
          expires_at: string
          id: string
          phone: string
          used: boolean
        }
        Insert: {
          attempts?: number
          code: string
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          used?: boolean
        }
        Update: {
          attempts?: number
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          used?: boolean
        }
        Relationships: []
      }
      worker_required_items: {
        Row: {
          completed_at: string | null
          completed_ref_id: string | null
          created_at: string
          due_date: string | null
          id: string
          is_deleted: boolean
          item_type: string
          legal_basis: string | null
          notes: string | null
          project_id: string
          source: string
          status: string
          subtype: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_ref_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          is_deleted?: boolean
          item_type: string
          legal_basis?: string | null
          notes?: string | null
          project_id: string
          source?: string
          status?: string
          subtype: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          completed_at?: string | null
          completed_ref_id?: string | null
          created_at?: string
          due_date?: string | null
          id?: string
          is_deleted?: boolean
          item_type?: string
          legal_basis?: string | null
          notes?: string | null
          project_id?: string
          source?: string
          status?: string
          subtype?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_required_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_required_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "worker_required_items_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_zone_events: {
        Row: {
          accuracy_m: number | null
          acknowledged: boolean
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          event_type: string
          id: string
          lat: number | null
          lng: number | null
          notes: string | null
          position_x: number | null
          position_y: number | null
          project_id: string
          source: string
          worker_name: string | null
          worker_phone: string | null
          worker_qr_id: string | null
          zone_id: string | null
        }
        Insert: {
          accuracy_m?: number | null
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          event_type: string
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          position_x?: number | null
          position_y?: number | null
          project_id: string
          source?: string
          worker_name?: string | null
          worker_phone?: string | null
          worker_qr_id?: string | null
          zone_id?: string | null
        }
        Update: {
          accuracy_m?: number | null
          acknowledged?: boolean
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lat?: number | null
          lng?: number | null
          notes?: string | null
          position_x?: number | null
          position_y?: number | null
          project_id?: string
          source?: string
          worker_name?: string | null
          worker_phone?: string | null
          worker_qr_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_zone_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_zone_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "worker_zone_events_worker_qr_id_fkey"
            columns: ["worker_qr_id"]
            isOneToOne: false
            referencedRelation: "worker_daily_qr"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_zone_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "site_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      workers: {
        Row: {
          assigned_chemicals: string[] | null
          assigned_processes: string[] | null
          birth_date: string | null
          company_id: string | null
          company_name: string
          created_at: string
          education_confirmed_at: string | null
          health_checkup_status:
            | Database["public"]["Enums"]["health_checkup_result"]
            | null
          health_grade: string | null
          health_restrictions: string | null
          hire_date: string | null
          id: string
          is_active: boolean
          job_type: string | null
          last_checkup_date: string | null
          name: string
          next_checkup_due: string | null
          outdoor_worker: boolean
          phone: string
          project_id: string
          qr_token: string
          requires_daily_health_log: boolean
          special_education_required_until: string | null
          updated_at: string
        }
        Insert: {
          assigned_chemicals?: string[] | null
          assigned_processes?: string[] | null
          birth_date?: string | null
          company_id?: string | null
          company_name?: string
          created_at?: string
          education_confirmed_at?: string | null
          health_checkup_status?:
            | Database["public"]["Enums"]["health_checkup_result"]
            | null
          health_grade?: string | null
          health_restrictions?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean
          job_type?: string | null
          last_checkup_date?: string | null
          name: string
          next_checkup_due?: string | null
          outdoor_worker?: boolean
          phone: string
          project_id: string
          qr_token?: string
          requires_daily_health_log?: boolean
          special_education_required_until?: string | null
          updated_at?: string
        }
        Update: {
          assigned_chemicals?: string[] | null
          assigned_processes?: string[] | null
          birth_date?: string | null
          company_id?: string | null
          company_name?: string
          created_at?: string
          education_confirmed_at?: string | null
          health_checkup_status?:
            | Database["public"]["Enums"]["health_checkup_result"]
            | null
          health_grade?: string | null
          health_restrictions?: string | null
          hire_date?: string | null
          id?: string
          is_active?: boolean
          job_type?: string | null
          last_checkup_date?: string | null
          name?: string
          next_checkup_due?: string | null
          outdoor_worker?: boolean
          phone?: string
          project_id?: string
          qr_token?: string
          requires_daily_health_log?: boolean
          special_education_required_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      zone_qr_codes: {
        Row: {
          code: string
          created_at: string
          direction: string
          id: string
          is_active: boolean
          label: string | null
          project_id: string
          zone_id: string
        }
        Insert: {
          code: string
          created_at?: string
          direction?: string
          id?: string
          is_active?: boolean
          label?: string | null
          project_id: string
          zone_id: string
        }
        Update: {
          code?: string
          created_at?: string
          direction?: string
          id?: string
          is_active?: boolean
          label?: string | null
          project_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_qr_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zone_qr_codes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "v_contractor_safety_scorecard"
            referencedColumns: ["project_id"]
          },
          {
            foreignKeyName: "zone_qr_codes_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "site_zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      project_assignee_pool: {
        Row: {
          company_id: string | null
          company_name: string | null
          department_id: string | null
          department_name: string | null
          display_name: string | null
          email: string | null
          phone: string | null
          position: string | null
          project_id: string | null
          source: string | null
          source_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
      v_contractor_safety_scorecard: {
        Row: {
          company_id: string | null
          company_name: string | null
          education_count: number | null
          incident_count: number | null
          major_incident_count: number | null
          overdue_actions: number | null
          project_id: string | null
          tbm_participations: number | null
          worker_count: number | null
        }
        Relationships: []
      }
      v_project_assignee_pool: {
        Row: {
          company_id: string | null
          company_name: string | null
          department_id: string | null
          department_name: string | null
          display_name: string | null
          email: string | null
          is_ssot: boolean | null
          phone: string | null
          position: string | null
          project_id: string | null
          source: string | null
          source_id: string | null
          user_id: string | null
        }
        Relationships: []
      }
      v_worker_attendance_today: {
        Row: {
          attendance_source: string | null
          attended: boolean | null
          company_id: string | null
          company_name: string | null
          entry_at: string | null
          exit_at: string | null
          exited: boolean | null
          project_id: string | null
          tbm_at: string | null
          work_date: string | null
          worker_id: string | null
          worker_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acknowledge_assessment_notice: {
        Args: { _notice_id: string }
        Returns: Json
      }
      act_on_approval: {
        Args: { _action: string; _approval_id: string; _comment?: string }
        Returns: Json
      }
      act_on_entity_approval: {
        Args: { _action: string; _approval_id: string; _comment?: string }
        Returns: Json
      }
      anonymize_old_location_data: { Args: never; Returns: number }
      apply_env_exceedance_to_risk: {
        Args: { _measurement_id: string }
        Returns: number
      }
      attachment_path_belongs_to_member: {
        Args: { _path: string; _uid: string }
        Returns: boolean
      }
      audit_data_consistency: { Args: never; Returns: Json }
      can_access_company_data: {
        Args: { _company_id: string; _project_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_safety_cost: {
        Args: {
          _company_id: string
          _project_id: string
          _user_id: string
          _write?: boolean
        }
        Returns: boolean
      }
      can_write_company_data: {
        Args: { _company_id: string; _project_id: string; _user_id: string }
        Returns: boolean
      }
      check_data_integrity: {
        Args: { _project_id?: string }
        Returns: {
          code: string
          count: number
          detail: string
          severity: string
        }[]
      }
      claim_idempotency: {
        Args: { _action: string; _key: string }
        Returns: Json
      }
      company_qr_check_in: {
        Args: {
          _action: string
          _edu_confirmed?: boolean
          _name: string
          _no_accident?: boolean
          _phone: string
          _ra_confirmed?: boolean
          _signature: string
          _tbm_confirmed?: boolean
          _token: string
        }
        Returns: Json
      }
      company_qr_check_in_idem: {
        Args: {
          _action: string
          _edu_confirmed?: boolean
          _idempotency_key?: string
          _name: string
          _no_accident?: boolean
          _phone: string
          _ra_confirmed?: boolean
          _signature: string
          _tbm_confirmed?: boolean
          _token: string
        }
        Returns: Json
      }
      compute_worker_required_education: {
        Args: { _worker_id: string }
        Returns: {
          education_type: string
          first_due_days: number
          interval_months: number
          job_type: string
          last_completed_at: string
          legal_basis: string
          next_due_at: string
          required_hours: number
          status: string
        }[]
      }
      confirm_worker_education: { Args: { _token: string }; Returns: Json }
      delegate_approval: {
        Args: {
          _approval_id: string
          _new_approver_id: string
          _reason: string
        }
        Returns: Json
      }
      derive_permit_from_work_plan: {
        Args: { _permit_date?: string; _work_plan_id: string }
        Returns: Json
      }
      derive_tbm_from_work_plan: {
        Args: { _tbm_date?: string; _work_plan_id: string }
        Returns: Json
      }
      ensure_master_allowlist: {
        Args: { _user_id: string }
        Returns: undefined
      }
      generate_legal_duty_todos: { Args: never; Returns: number }
      generate_worker_required_items: {
        Args: { _worker_id: string }
        Returns: number
      }
      get_company_qr_by_token: { Args: { _token: string }; Returns: Json }
      get_daily_qr_status: { Args: { _token: string }; Returns: Json }
      get_eligible_approvers: {
        Args: { _project_id: string; _submitter_company_id: string }
        Returns: {
          out_company_id: string
          out_company_name: string
          out_company_type: string
          out_display_name: string
          out_position: string
          out_role: string
          out_user_id: string
        }[]
      }
      get_hazard_survey_public: { Args: { _qr_token: string }; Returns: Json }
      get_latest_app_release: {
        Args: { _channel?: string }
        Returns: {
          bundle_url: string
          channel: string
          checksum: string
          mandatory: boolean
          min_native_version: string
          released_at: string
          version: string
        }[]
      }
      get_my_pending_entity_approvals: {
        Args: never
        Returns: {
          approval_id: string
          created_at: string
          entity_date: string
          entity_id: string
          entity_title: string
          entity_type: string
          project_id: string
          step: string
          step_order: number
          step_position: string
        }[]
      }
      get_project_role: {
        Args: { _project_id: string; _user_id: string }
        Returns: string
      }
      get_project_role_new: {
        Args: { _project_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["project_role"]
      }
      get_tbm_by_token: { Args: { _token: string }; Returns: Json }
      get_user_company_id: {
        Args: { _project_id: string; _user_id: string }
        Returns: string
      }
      get_user_position: {
        Args: { _project_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["project_position"]
      }
      get_worker_by_token: { Args: { _token: string }; Returns: Json }
      get_worker_health_warnings: {
        Args: { _worker_id: string }
        Returns: Json
      }
      get_worker_today_content: { Args: { _token: string }; Returns: Json }
      get_wpa_missing_mandatory: {
        Args: { _plan_id: string }
        Returns: {
          attachment_key: string
          category: string
          name: string
        }[]
      }
      has_permission: {
        Args: {
          _action: string
          _feature: string
          _project_id: string
          _user_id: string
        }
        Returns: boolean
      }
      has_project_role: {
        Args: {
          _project_id: string
          _roles: Database["public"]["Enums"]["project_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_company_project_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      is_global_admin: { Args: { _user_id: string }; Returns: boolean }
      is_master: { Args: { _user_id: string }; Returns: boolean }
      is_project_admin: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
      issue_company_daily_qr: {
        Args: { _company_id: string; _work_date?: string }
        Returns: Json
      }
      issue_daily_qr: { Args: { _worker_id: string }; Returns: Json }
      list_joinable_projects: {
        Args: never
        Returns: {
          id: string
          name: string
          site_name: string
          status: string
        }[]
      }
      mark_required_items_overdue: { Args: never; Returns: number }
      migrate_legacy_to_ssot: { Args: { _project_id?: string }; Returns: Json }
      preview_required_education: {
        Args: { _job_type: string; _project_id: string }
        Returns: {
          education_type: string
          first_due_days: number
          interval_months: number
          legal_basis: string
          required_hours: number
        }[]
      }
      process_invite_code: {
        Args: { _invite_code: string; _user_id: string }
        Returns: Json
      }
      purge_old_idempotency_keys: { Args: never; Returns: number }
      qa_impersonate_check: {
        Args: { _project_id: string; _target_user: string }
        Returns: Json
      }
      register_worker: {
        Args: {
          _company_id?: string
          _company_name: string
          _name: string
          _phone: string
          _project_id: string
        }
        Returns: Json
      }
      request_worker_otp: { Args: { _phone: string }; Returns: Json }
      resync_assessment_run_status: { Args: { _run_id: string }; Returns: Json }
      run_daily_consistency_audit: { Args: never; Returns: Json }
      save_idempotency_response: {
        Args: { _key: string; _response: Json }
        Returns: undefined
      }
      shares_project_with: {
        Args: { _target: string; _viewer: string }
        Returns: boolean
      }
      should_push_notify: {
        Args: { _type: string; _user_id: string }
        Returns: boolean
      }
      submit_approval: {
        Args: {
          _company_id: string
          _entity_id: string
          _entity_type: string
          _project_id: string
          _reason?: string
          _steps: Json
        }
        Returns: number
      }
      submit_entity_for_approval: {
        Args: { _entity_id: string; _entity_type: string; _project_id: string }
        Returns: Json
      }
      submit_hazard_survey_response: {
        Args: {
          _company_name: string
          _qr_token: string
          _scores: Json
          _worker_name: string
          _worker_phone: string
        }
        Returns: Json
      }
      submit_tbm_participation: {
        Args: {
          _briefing_confirmed: boolean
          _company_name: string
          _ip_hash: string
          _signature_data: string
          _token: string
          _user_agent: string
          _worker_name: string
          _worker_phone: string
        }
        Returns: Json
      }
      validate_safety_cost_report: {
        Args: { _report_id: string }
        Returns: Json
      }
      verify_worker_otp: {
        Args: { _code: string; _phone: string }
        Returns: Json
      }
      worker_daily_scan:
        | {
            Args: {
              _action: string
              _edu_confirmed?: boolean
              _no_accident?: boolean
              _ra_confirmed?: boolean
              _signature: string
              _tbm_confirmed?: boolean
              _token: string
            }
            Returns: Json
          }
        | {
            Args: {
              _ack_warnings?: boolean
              _action: string
              _edu_confirmed?: boolean
              _no_accident?: boolean
              _ra_confirmed?: boolean
              _signature: string
              _tbm_confirmed?: boolean
              _token: string
            }
            Returns: Json
          }
      worker_entry: {
        Args: {
          _edu_confirmed: boolean
          _ra_confirmed: boolean
          _signature: string
          _tbm_confirmed: boolean
          _token: string
          _work_permit_id: string
        }
        Returns: Json
      }
      worker_exit: {
        Args: { _no_accident: boolean; _signature: string; _token: string }
        Returns: Json
      }
    }
    Enums: {
      env_factor_category:
        | "소음"
        | "분진"
        | "화학물질"
        | "물리적"
        | "생물학적"
        | "진동"
        | "조명"
        | "고온"
      global_role: "master"
      hazard_survey_type: "근골격계" | "뇌심혈관" | "직무스트레스" | "감정노동"
      health_checkup_result:
        | "정상A"
        | "정상B"
        | "요관찰C"
        | "유소견D1"
        | "유소견D2"
        | "판정불가"
        | "미수검"
      health_checkup_type: "일반" | "특수" | "배치전" | "수시" | "임시"
      health_education_type:
        | "정기"
        | "특별"
        | "관리감독자"
        | "MSDS"
        | "신규채용"
        | "작업변경"
      project_position:
        | "CEO"
        | "EXECUTIVE"
        | "SITE_MANAGER"
        | "HSE_MANAGER"
        | "CONSTRUCTION_MGR"
        | "FIELD_ENGINEER"
        | "FOREMAN"
        | "WORKER"
        | "OWNER_PM"
        | "OWNER_HSE"
        | "SUPERVISOR"
      project_role:
        | "project_admin"
        | "safety_manager"
        | "site_manager"
        | "supervisor"
        | "worker"
        | "viewer"
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
      env_factor_category: [
        "소음",
        "분진",
        "화학물질",
        "물리적",
        "생물학적",
        "진동",
        "조명",
        "고온",
      ],
      global_role: ["master"],
      hazard_survey_type: ["근골격계", "뇌심혈관", "직무스트레스", "감정노동"],
      health_checkup_result: [
        "정상A",
        "정상B",
        "요관찰C",
        "유소견D1",
        "유소견D2",
        "판정불가",
        "미수검",
      ],
      health_checkup_type: ["일반", "특수", "배치전", "수시", "임시"],
      health_education_type: [
        "정기",
        "특별",
        "관리감독자",
        "MSDS",
        "신규채용",
        "작업변경",
      ],
      project_position: [
        "CEO",
        "EXECUTIVE",
        "SITE_MANAGER",
        "HSE_MANAGER",
        "CONSTRUCTION_MGR",
        "FIELD_ENGINEER",
        "FOREMAN",
        "WORKER",
        "OWNER_PM",
        "OWNER_HSE",
        "SUPERVISOR",
      ],
      project_role: [
        "project_admin",
        "safety_manager",
        "site_manager",
        "supervisor",
        "worker",
        "viewer",
      ],
    },
  },
} as const
