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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      applicants: {
        Row: {
          applicant_email: string
          birth_date: string
          config_id: string
          created_at: string
          email: string
          first_name: string
          gender: string
          id: string
          last_name: string
          nationality: string
          passport: string
          passport_expiry: string
          phone: string
          phone_number: string
          sort_order: number
        }
        Insert: {
          applicant_email?: string
          birth_date?: string
          config_id: string
          created_at?: string
          email?: string
          first_name?: string
          gender?: string
          id?: string
          last_name?: string
          nationality?: string
          passport?: string
          passport_expiry?: string
          phone?: string
          phone_number?: string
          sort_order?: number
        }
        Update: {
          applicant_email?: string
          birth_date?: string
          config_id?: string
          created_at?: string
          email?: string
          first_name?: string
          gender?: string
          id?: string
          last_name?: string
          nationality?: string
          passport?: string
          passport_expiry?: string
          phone?: string
          phone_number?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "applicants_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "tracking_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          user_agent: string | null
          user_email: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_email: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          user_agent?: string | null
          user_email?: string
          user_id?: string | null
        }
        Relationships: []
      }
      bot_settings: {
        Row: {
          id: string
          key: string
          label: string | null
          updated_at: string
          value: string
        }
        Insert: {
          id?: string
          key: string
          label?: string | null
          updated_at?: string
          value?: string
        }
        Update: {
          id?: string
          key?: string
          label?: string | null
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      idata_accounts: {
        Row: {
          banned_until: string | null
          birth_day: string
          birth_month: string
          birth_year: string
          booking_enabled: boolean
          created_at: string
          email: string
          fail_count: number
          first_name: string
          id: string
          idata_office: string | null
          imap_host: string | null
          imap_password: string | null
          invoice_address: string | null
          invoice_city: string | null
          invoice_district: string | null
          invoice_type: string
          last_name: string
          last_used_at: string | null
          manual_otp: string | null
          membership_number: string | null
          notes: string | null
          otp_requested_at: string | null
          passport_no: string
          password: string
          phone: string | null
          registration_otp: string | null
          registration_otp_type: string | null
          registration_status: string | null
          residence_city: string | null
          status: string
          travel_date: string | null
          travel_purpose: string | null
          updated_at: string
        }
        Insert: {
          banned_until?: string | null
          birth_day?: string
          birth_month?: string
          birth_year?: string
          booking_enabled?: boolean
          created_at?: string
          email: string
          fail_count?: number
          first_name?: string
          id?: string
          idata_office?: string | null
          imap_host?: string | null
          imap_password?: string | null
          invoice_address?: string | null
          invoice_city?: string | null
          invoice_district?: string | null
          invoice_type?: string
          last_name?: string
          last_used_at?: string | null
          manual_otp?: string | null
          membership_number?: string | null
          notes?: string | null
          otp_requested_at?: string | null
          passport_no?: string
          password: string
          phone?: string | null
          registration_otp?: string | null
          registration_otp_type?: string | null
          registration_status?: string | null
          residence_city?: string | null
          status?: string
          travel_date?: string | null
          travel_purpose?: string | null
          updated_at?: string
        }
        Update: {
          banned_until?: string | null
          birth_day?: string
          birth_month?: string
          birth_year?: string
          booking_enabled?: boolean
          created_at?: string
          email?: string
          fail_count?: number
          first_name?: string
          id?: string
          idata_office?: string | null
          imap_host?: string | null
          imap_password?: string | null
          invoice_address?: string | null
          invoice_city?: string | null
          invoice_district?: string | null
          invoice_type?: string
          last_name?: string
          last_used_at?: string | null
          manual_otp?: string | null
          membership_number?: string | null
          notes?: string | null
          otp_requested_at?: string | null
          passport_no?: string
          password?: string
          phone?: string | null
          registration_otp?: string | null
          registration_otp_type?: string | null
          registration_status?: string | null
          residence_city?: string | null
          status?: string
          travel_date?: string | null
          travel_purpose?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      idata_city_offices: {
        Row: {
          city: string
          created_at: string
          id: string
          office_name: string
          office_value: string
        }
        Insert: {
          city: string
          created_at?: string
          id?: string
          office_name: string
          office_value: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          office_name?: string
          office_value?: string
        }
        Relationships: []
      }
      idata_config: {
        Row: {
          cf_blocked_ip: string | null
          cf_blocked_since: string | null
          cf_retry_requested: boolean
          check_interval: number
          created_at: string
          id: string
          is_active: boolean
          updated_at: string
        }
        Insert: {
          cf_blocked_ip?: string | null
          cf_blocked_since?: string | null
          cf_retry_requested?: boolean
          check_interval?: number
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Update: {
          cf_blocked_ip?: string | null
          cf_blocked_since?: string | null
          cf_retry_requested?: boolean
          check_interval?: number
          created_at?: string
          id?: string
          is_active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      idata_tracking_logs: {
        Row: {
          created_at: string
          id: string
          message: string | null
          screenshot_url: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          screenshot_url?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          screenshot_url?: string | null
          status?: string
        }
        Relationships: []
      }
      link_analyses: {
        Row: {
          ai_answer: string | null
          created_at: string
          id: string
          page_content: string | null
          page_title: string | null
          status: string
          url: string
        }
        Insert: {
          ai_answer?: string | null
          created_at?: string
          id?: string
          page_content?: string | null
          page_title?: string | null
          status?: string
          url: string
        }
        Update: {
          ai_answer?: string | null
          created_at?: string
          id?: string
          page_content?: string | null
          page_title?: string | null
          status?: string
          url?: string
        }
        Relationships: []
      }
      quiz_accounts: {
        Row: {
          created_at: string
          email: string
          fail_count: number
          id: string
          last_used_at: string | null
          notes: string | null
          password: string
          platform: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          fail_count?: number
          id?: string
          last_used_at?: string | null
          notes?: string | null
          password: string
          platform?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          fail_count?: number
          id?: string
          last_used_at?: string | null
          notes?: string | null
          password?: string
          platform?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      quiz_tracking_logs: {
        Row: {
          created_at: string
          id: string
          message: string | null
          screenshot_url: string | null
          status: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          screenshot_url?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          screenshot_url?: string | null
          status?: string
        }
        Relationships: []
      }
      server_commands: {
        Row: {
          command: string
          created_at: string
          executed_at: string | null
          id: string
          output: string | null
          status: string
          target: string
        }
        Insert: {
          command: string
          created_at?: string
          executed_at?: string | null
          id?: string
          output?: string | null
          status?: string
          target?: string
        }
        Update: {
          command?: string
          created_at?: string
          executed_at?: string | null
          id?: string
          output?: string | null
          status?: string
          target?: string
        }
        Relationships: []
      }
      tracking_configs: {
        Row: {
          cf_blocked_ip: string | null
          cf_blocked_since: string | null
          cf_retry_requested: boolean
          check_interval: number
          city: string
          country: string
          created_at: string
          id: string
          is_active: boolean
          keep_alive: boolean
          person_count: number
          screenshot_requested: boolean
          telegram_chat_id: string | null
          updated_at: string
          visa_category: string | null
          visa_subcategory: string | null
          webhook_url: string | null
        }
        Insert: {
          cf_blocked_ip?: string | null
          cf_blocked_since?: string | null
          cf_retry_requested?: boolean
          check_interval?: number
          city: string
          country: string
          created_at?: string
          id?: string
          is_active?: boolean
          keep_alive?: boolean
          person_count?: number
          screenshot_requested?: boolean
          telegram_chat_id?: string | null
          updated_at?: string
          visa_category?: string | null
          visa_subcategory?: string | null
          webhook_url?: string | null
        }
        Update: {
          cf_blocked_ip?: string | null
          cf_blocked_since?: string | null
          cf_retry_requested?: boolean
          check_interval?: number
          city?: string
          country?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keep_alive?: boolean
          person_count?: number
          screenshot_requested?: boolean
          telegram_chat_id?: string | null
          updated_at?: string
          visa_category?: string | null
          visa_subcategory?: string | null
          webhook_url?: string | null
        }
        Relationships: []
      }
      tracking_logs: {
        Row: {
          config_id: string
          created_at: string
          id: string
          message: string | null
          screenshot_url: string | null
          slots_available: number | null
          status: string
        }
        Insert: {
          config_id: string
          created_at?: string
          id?: string
          message?: string | null
          screenshot_url?: string | null
          slots_available?: number | null
          status?: string
        }
        Update: {
          config_id?: string
          created_at?: string
          id?: string
          message?: string | null
          screenshot_url?: string | null
          slots_available?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_logs_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "tracking_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          allowed_tabs: string[]
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          allowed_tabs?: string[]
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          allowed_tabs?: string[]
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vfs_accounts: {
        Row: {
          banned_until: string | null
          booking_enabled: boolean
          captcha_manual_approved: boolean | null
          captcha_waiting_at: string | null
          created_at: string
          email: string
          fail_count: number
          id: string
          imap_host: string | null
          imap_last_checked_at: string | null
          imap_last_message: string | null
          imap_last_status: string | null
          imap_password: string | null
          last_used_at: string | null
          manual_otp: string | null
          notes: string | null
          otp_mode: string
          otp_requested_at: string | null
          password: string
          phone: string | null
          registration_otp: string | null
          registration_otp_type: string | null
          registration_status: string | null
          status: string
          updated_at: string
        }
        Insert: {
          banned_until?: string | null
          booking_enabled?: boolean
          captcha_manual_approved?: boolean | null
          captcha_waiting_at?: string | null
          created_at?: string
          email: string
          fail_count?: number
          id?: string
          imap_host?: string | null
          imap_last_checked_at?: string | null
          imap_last_message?: string | null
          imap_last_status?: string | null
          imap_password?: string | null
          last_used_at?: string | null
          manual_otp?: string | null
          notes?: string | null
          otp_mode?: string
          otp_requested_at?: string | null
          password: string
          phone?: string | null
          registration_otp?: string | null
          registration_otp_type?: string | null
          registration_status?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          banned_until?: string | null
          booking_enabled?: boolean
          captcha_manual_approved?: boolean | null
          captcha_waiting_at?: string | null
          created_at?: string
          email?: string
          fail_count?: number
          id?: string
          imap_host?: string | null
          imap_last_checked_at?: string | null
          imap_last_message?: string | null
          imap_last_status?: string | null
          imap_password?: string | null
          last_used_at?: string | null
          manual_otp?: string | null
          notes?: string | null
          otp_mode?: string
          otp_requested_at?: string | null
          password?: string
          phone?: string | null
          registration_otp?: string | null
          registration_otp_type?: string | null
          registration_status?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      vfs_countries: {
        Row: {
          code: string
          created_at: string
          flag: string
          id: string
          is_active: boolean
          label: string
          sort_order: number
          value: string
        }
        Insert: {
          code: string
          created_at?: string
          flag?: string
          id?: string
          is_active?: boolean
          label: string
          sort_order?: number
          value: string
        }
        Update: {
          code?: string
          created_at?: string
          flag?: string
          id?: string
          is_active?: boolean
          label?: string
          sort_order?: number
          value?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
