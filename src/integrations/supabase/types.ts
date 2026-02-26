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
      approvals: {
        Row: {
          approver_id: string | null
          approver_name: string | null
          comment: string | null
          created_at: string
          id: string
          project_id: string
          risk_item_id: string | null
          status: string
          step: string
          updated_at: string
          version: number | null
        }
        Insert: {
          approver_id?: string | null
          approver_name?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          project_id: string
          risk_item_id?: string | null
          status?: string
          step: string
          updated_at?: string
          version?: number | null
        }
        Update: {
          approver_id?: string | null
          approver_name?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          project_id?: string
          risk_item_id?: string | null
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
      profiles: {
        Row: {
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
      project_members: {
        Row: {
          company: string | null
          created_at: string
          id: string
          project_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          id?: string
          project_id: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          id?: string
          project_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
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
        Relationships: []
      }
      risk_items: {
        Row: {
          assignee: string | null
          created_at: string
          created_by: string | null
          department: string | null
          existing_measure: string | null
          frequency: number
          hazard: string | null
          hazard_situation: string | null
          id: string
          improved_frequency: number
          improved_risk: number | null
          improved_severity: number
          improvement_measure: string | null
          legal_basis: string[] | null
          note: string | null
          ppe: string[] | null
          process: string
          project_id: string
          risk: number | null
          severity: number
          sort_order: number | null
          status: string
          sub_task: string | null
          updated_at: string
        }
        Insert: {
          assignee?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          existing_measure?: string | null
          frequency?: number
          hazard?: string | null
          hazard_situation?: string | null
          id?: string
          improved_frequency?: number
          improved_risk?: number | null
          improved_severity?: number
          improvement_measure?: string | null
          legal_basis?: string[] | null
          note?: string | null
          ppe?: string[] | null
          process: string
          project_id: string
          risk?: number | null
          severity?: number
          sort_order?: number | null
          status?: string
          sub_task?: string | null
          updated_at?: string
        }
        Update: {
          assignee?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          existing_measure?: string | null
          frequency?: number
          hazard?: string | null
          hazard_situation?: string | null
          id?: string
          improved_frequency?: number
          improved_risk?: number | null
          improved_severity?: number
          improvement_measure?: string | null
          legal_basis?: string[] | null
          note?: string | null
          ppe?: string[] | null
          process?: string
          project_id?: string
          risk?: number | null
          severity?: number
          sort_order?: number | null
          status?: string
          sub_task?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
          improved_severity: number
          improvement_measure: string | null
          legal_keywords: string[] | null
          ppe: string[] | null
          process_keyword: string
          severity: number
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
          improved_severity?: number
          improvement_measure?: string | null
          legal_keywords?: string[] | null
          ppe?: string[] | null
          process_keyword: string
          severity?: number
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
          improved_severity?: number
          improvement_measure?: string | null
          legal_keywords?: string[] | null
          ppe?: string[] | null
          process_keyword?: string
          severity?: number
          sub_task?: string
          updated_at?: string
        }
        Relationships: []
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
      is_project_member: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "master"
        | "project_admin"
        | "safety_manager"
        | "contractor"
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
      app_role: [
        "master",
        "project_admin",
        "safety_manager",
        "contractor",
        "viewer",
      ],
    },
  },
} as const
