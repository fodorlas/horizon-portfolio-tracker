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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_type: string
          created_at: string
          id: string
          institution_id: string
          name: string
          owner_id: string
          tracking_start_date: string
        }
        Insert: {
          account_type?: string
          created_at?: string
          id?: string
          institution_id: string
          name: string
          owner_id?: string
          tracking_start_date: string
        }
        Update: {
          account_type?: string
          created_at?: string
          id?: string
          institution_id?: string
          name?: string
          owner_id?: string
          tracking_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_institution_id_owner_id_fkey"
            columns: ["institution_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      bond_observations: {
        Row: {
          accrued: number
          ask: number | null
          bid: number
          check_result: string
          coupon: number | null
          day: string
          id: string
          instrument_id: string
          owner_id: string
          settle_date: string
        }
        Insert: {
          accrued: number
          ask?: number | null
          bid: number
          check_result: string
          coupon?: number | null
          day: string
          id?: string
          instrument_id: string
          owner_id?: string
          settle_date: string
        }
        Update: {
          accrued?: number
          ask?: number | null
          bid?: number
          check_result?: string
          coupon?: number | null
          day?: string
          id?: string
          instrument_id?: string
          owner_id?: string
          settle_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "bond_observations_instrument_id_owner_id_fkey"
            columns: ["instrument_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      bond_rates: {
        Row: {
          id: string
          owner_id: string
          period_end: string
          period_start: string
          rate: number
          series: string
        }
        Insert: {
          id?: string
          owner_id?: string
          period_end: string
          period_start: string
          rate: number
          series: string
        }
        Update: {
          id?: string
          owner_id?: string
          period_end?: string
          period_start?: string
          rate?: number
          series?: string
        }
        Relationships: []
      }
      bond_terms: {
        Row: {
          check_status: string
          checked_on: string | null
          instrument_id: string
          issue_date: string
          maturity_date: string
          owner_id: string
          security_type: string
          series: string
          tab: string
        }
        Insert: {
          check_status?: string
          checked_on?: string | null
          instrument_id: string
          issue_date: string
          maturity_date: string
          owner_id?: string
          security_type: string
          series: string
          tab: string
        }
        Update: {
          check_status?: string
          checked_on?: string | null
          instrument_id?: string
          issue_date?: string
          maturity_date?: string
          owner_id?: string
          security_type?: string
          series?: string
          tab?: string
        }
        Relationships: [
          {
            foreignKeyName: "bond_terms_instrument_id_owner_id_fkey"
            columns: ["instrument_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      events: {
        Row: {
          correction_kind: string | null
          created_at: string
          entry_id: string | null
          event_date: string
          event_type: string
          id: string
          note: string | null
          owner_id: string
          split_ratio: number | null
        }
        Insert: {
          correction_kind?: string | null
          created_at?: string
          entry_id?: string | null
          event_date: string
          event_type: string
          id?: string
          note?: string | null
          owner_id?: string
          split_ratio?: number | null
        }
        Update: {
          correction_kind?: string | null
          created_at?: string
          entry_id?: string | null
          event_date?: string
          event_type?: string
          id?: string
          note?: string | null
          owner_id?: string
          split_ratio?: number | null
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          base: string
          event_id: string | null
          fetched_at: string
          id: string
          note: string | null
          quote: string
          rate: number
          rate_date: string
          raw_unit: number
          source: string
          status: string
          supersedes_id: string | null
        }
        Insert: {
          base: string
          event_id?: string | null
          fetched_at?: string
          id?: string
          note?: string | null
          quote: string
          rate: number
          rate_date: string
          raw_unit?: number
          source: string
          status?: string
          supersedes_id?: string | null
        }
        Update: {
          base?: string
          event_id?: string | null
          fetched_at?: string
          id?: string
          note?: string | null
          quote?: string
          rate?: number
          rate_date?: string
          raw_unit?: number
          source?: string
          status?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fx_rates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_rates_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "fx_effective"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_rates_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "fx_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      institutions: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      instruments: {
        Row: {
          asset_class: string
          created_at: string
          currency: string
          exchange: string | null
          id: string
          isin: string | null
          name: string
          owner_id: string
          price_source: string
          provider_symbol: string | null
          stale_after_days: number | null
          ticker: string | null
          valuation: string
        }
        Insert: {
          asset_class: string
          created_at?: string
          currency: string
          exchange?: string | null
          id?: string
          isin?: string | null
          name: string
          owner_id?: string
          price_source?: string
          provider_symbol?: string | null
          stale_after_days?: number | null
          ticker?: string | null
          valuation?: string
        }
        Update: {
          asset_class?: string
          created_at?: string
          currency?: string
          exchange?: string | null
          id?: string
          isin?: string | null
          name?: string
          owner_id?: string
          price_source?: string
          provider_symbol?: string | null
          stale_after_days?: number | null
          ticker?: string | null
          valuation?: string
        }
        Relationships: []
      }
      lines: {
        Row: {
          account_id: string
          amount: number
          cost_amount: number | null
          cost_estimated: boolean
          cost_fx_refs: Json | null
          currency: string
          event_id: string
          id: string
          instrument_id: string | null
          kind: string
          owner_id: string
          role: string
        }
        Insert: {
          account_id: string
          amount: number
          cost_amount?: number | null
          cost_estimated?: boolean
          cost_fx_refs?: Json | null
          currency: string
          event_id: string
          id?: string
          instrument_id?: string | null
          kind: string
          owner_id?: string
          role: string
        }
        Update: {
          account_id?: string
          amount?: number
          cost_amount?: number | null
          cost_estimated?: boolean
          cost_fx_refs?: Json | null
          currency?: string
          event_id?: string
          id?: string
          instrument_id?: string | null
          kind?: string
          owner_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "lines_account_id_owner_id_fkey"
            columns: ["account_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "lines_event_id_owner_id_fkey"
            columns: ["event_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "lines_instrument_id_owner_id_fkey"
            columns: ["instrument_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      manual_valuations: {
        Row: {
          account_id: string
          as_of: string
          currency: string
          entered_at: string
          entry_id: string | null
          id: string
          instrument_id: string
          note: string | null
          owner_id: string
          source: string
          status: string
          supersedes_id: string | null
          value: number
        }
        Insert: {
          account_id: string
          as_of: string
          currency: string
          entered_at?: string
          entry_id?: string | null
          id?: string
          instrument_id: string
          note?: string | null
          owner_id?: string
          source?: string
          status?: string
          supersedes_id?: string | null
          value: number
        }
        Update: {
          account_id?: string
          as_of?: string
          currency?: string
          entered_at?: string
          entry_id?: string | null
          id?: string
          instrument_id?: string
          note?: string | null
          owner_id?: string
          source?: string
          status?: string
          supersedes_id?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "manual_valuations_account_id_owner_id_fkey"
            columns: ["account_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "manual_valuations_instrument_id_owner_id_fkey"
            columns: ["instrument_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "manual_valuations_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "manual_valuations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_events: {
        Row: {
          account_id: string
          amount: number | null
          basis: Json
          due_date: string
          edited: boolean
          entry_id: string | null
          id: string
          instrument_id: string
          kind: string
          nominal: number
          owner_id: string
          percent: number | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id: string
          amount?: number | null
          basis?: Json
          due_date: string
          edited?: boolean
          entry_id?: string | null
          id?: string
          instrument_id: string
          kind: string
          nominal: number
          owner_id?: string
          percent?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number | null
          basis?: Json
          due_date?: string
          edited?: boolean
          entry_id?: string | null
          id?: string
          instrument_id?: string
          kind?: string
          nominal?: number
          owner_id?: string
          percent?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_events_account_id_owner_id_fkey"
            columns: ["account_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "pending_events_instrument_id_owner_id_fkey"
            columns: ["instrument_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      price_quotes: {
        Row: {
          as_of: string
          currency: string
          entered_at: string
          entry_id: string | null
          id: string
          instrument_id: string
          note: string | null
          owner_id: string
          price: number
          source: string
          status: string
          supersedes_id: string | null
        }
        Insert: {
          as_of: string
          currency: string
          entered_at?: string
          entry_id?: string | null
          id?: string
          instrument_id: string
          note?: string | null
          owner_id?: string
          price: number
          source: string
          status?: string
          supersedes_id?: string | null
        }
        Update: {
          as_of?: string
          currency?: string
          entered_at?: string
          entry_id?: string | null
          id?: string
          instrument_id?: string
          note?: string | null
          owner_id?: string
          price?: number
          source?: string
          status?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_quotes_instrument_id_owner_id_fkey"
            columns: ["instrument_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "instruments"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "price_quotes_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "price_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_log: {
        Row: {
          at: string
          id: string
          inserted: number
          item: string
          kind: string
          message: string | null
          owner_id: string
          range_from: string | null
          range_to: string | null
          run_id: string
          source: string
          status: string
          suspect: number
          unchecked: number
        }
        Insert: {
          at?: string
          id?: string
          inserted?: number
          item: string
          kind: string
          message?: string | null
          owner_id?: string
          range_from?: string | null
          range_to?: string | null
          run_id: string
          source: string
          status: string
          suspect?: number
          unchecked?: number
        }
        Update: {
          at?: string
          id?: string
          inserted?: number
          item?: string
          kind?: string
          message?: string | null
          owner_id?: string
          range_from?: string | null
          range_to?: string | null
          run_id?: string
          source?: string
          status?: string
          suspect?: number
          unchecked?: number
        }
        Relationships: []
      }
    }
    Views: {
      fx_effective: {
        Row: {
          base: string | null
          fetched_at: string | null
          id: string | null
          quote: string | null
          rate: number | null
          rate_date: string | null
          source: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      delete_account: {
        Args: { p_account: string; p_name: string }
        Returns: Json
      }
      delete_entry: { Args: { p_entry: string }; Returns: number }
      delete_instrument: { Args: { p_instrument: string }; Returns: undefined }
      fx_coverage: {
        Args: never
        Returns: {
          currency: string
          first_day: string
          last_day: string
          source: string
        }[]
      }
      fx_leg: {
        Args: { p_day: string; p_from: string; p_source: string; p_to: string }
        Returns: Record<string, unknown>
      }
      price_coverage: {
        Args: never
        Returns: {
          first_day: string
          instrument_id: string
          last_day: string
          last_entered: string
          source: string
        }[]
      }
      price_quotes_from: {
        Args: { p_from: string }
        Returns: {
          as_of: string
          currency: string
          entered_at: string
          entry_id: string | null
          id: string
          instrument_id: string
          note: string | null
          owner_id: string
          price: number
          source: string
          status: string
          supersedes_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "price_quotes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_entry: { Args: { p: Json }; Returns: string[] }
      record_event: { Args: { p_event: Json; p_lines: Json }; Returns: string }
      record_event_bundle: {
        Args: { p_event: Json; p_extras?: Json; p_lines: Json }
        Returns: string
      }
      record_fx_rates: { Args: { p_rows: Json }; Returns: number }
      record_quotes: { Args: { p_rows: Json }; Returns: number }
      replace_entry: { Args: { p: Json; p_entry: string }; Returns: string[] }
      select_fx: {
        Args: { p_day: string; p_from: string; p_to: string }
        Returns: {
          kind: string
          method: string
          rate: number
          rate_date: string
          row_ids: string[]
          source: string
          via: string
        }[]
      }
      select_price: {
        Args: { p_day: string; p_instrument: string }
        Returns: {
          as_of: string
          currency: string
          entered_at: string
          entry_id: string | null
          id: string
          instrument_id: string
          note: string | null
          owner_id: string
          price: number
          source: string
          status: string
          supersedes_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "price_quotes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      select_valuation: {
        Args: { p_account: string; p_day: string; p_instrument: string }
        Returns: {
          account_id: string
          as_of: string
          currency: string
          entered_at: string
          entry_id: string | null
          id: string
          instrument_id: string
          note: string | null
          owner_id: string
          source: string
          status: string
          supersedes_id: string | null
          value: number
        }[]
        SetofOptions: {
          from: "*"
          to: "manual_valuations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      session_status: { Args: never; Returns: Json }
      sync_pending_events: {
        Args: { p_read_at?: string; p_rows: Json }
        Returns: number
      }
      write_entry: {
        Args: { p: Json; p_created_at: string }
        Returns: string[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
