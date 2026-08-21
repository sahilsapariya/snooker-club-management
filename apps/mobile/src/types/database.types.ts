export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      activity_logs: {
        Row: {
          action: string;
          actor_role: string | null;
          actor_user_id: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: number;
          metadata: Json;
          summary: string | null;
          tenant_id: string | null;
        };
        Insert: {
          action: string;
          actor_role?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          metadata?: Json;
          summary?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor_role?: string | null;
          actor_user_id?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          metadata?: Json;
          summary?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "activity_logs_actor_user_id_fkey";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_logs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      cash_closings: {
        Row: {
          actual_cash_minor: number | null;
          business_date: string;
          cash_expenses_minor: number;
          cash_received_minor: number;
          closed_at: string | null;
          closed_by: string | null;
          created_at: string;
          difference_minor: number | null;
          expected_cash_minor: number | null;
          id: string;
          notes: string | null;
          opened_at: string;
          opened_by: string | null;
          opening_cash_minor: number;
          status: Database["public"]["Enums"]["cash_closing_status"];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          actual_cash_minor?: number | null;
          business_date: string;
          cash_expenses_minor?: number;
          cash_received_minor?: number;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          difference_minor?: number | null;
          expected_cash_minor?: number | null;
          id?: string;
          notes?: string | null;
          opened_at?: string;
          opened_by?: string | null;
          opening_cash_minor?: number;
          status?: Database["public"]["Enums"]["cash_closing_status"];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          actual_cash_minor?: number | null;
          business_date?: string;
          cash_expenses_minor?: number;
          cash_received_minor?: number;
          closed_at?: string | null;
          closed_by?: string | null;
          created_at?: string;
          difference_minor?: number | null;
          expected_cash_minor?: number | null;
          id?: string;
          notes?: string | null;
          opened_at?: string;
          opened_by?: string | null;
          opening_cash_minor?: number;
          status?: Database["public"]["Enums"]["cash_closing_status"];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cash_closings_closed_by_fkey";
            columns: ["closed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_closings_opened_by_fkey";
            columns: ["opened_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cash_closings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      club_tables: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          notes: string | null;
          sort_order: number;
          status: Database["public"]["Enums"]["club_table_status"];
          table_number: number | null;
          table_type_id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          notes?: string | null;
          sort_order?: number;
          status?: Database["public"]["Enums"]["club_table_status"];
          table_number?: number | null;
          table_type_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          notes?: string | null;
          sort_order?: number;
          status?: Database["public"]["Enums"]["club_table_status"];
          table_number?: number | null;
          table_type_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "club_tables_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "club_tables_type_same_tenant";
            columns: ["tenant_id", "table_type_id"];
            isOneToOne: false;
            referencedRelation: "table_types";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      device_push_tokens: {
        Row: {
          app_version: string | null;
          created_at: string;
          device_id: string | null;
          device_name: string | null;
          expo_push_token: string;
          id: string;
          is_active: boolean;
          last_seen_at: string;
          platform: Database["public"]["Enums"]["device_platform"];
          tenant_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          app_version?: string | null;
          created_at?: string;
          device_id?: string | null;
          device_name?: string | null;
          expo_push_token: string;
          id?: string;
          is_active?: boolean;
          last_seen_at?: string;
          platform: Database["public"]["Enums"]["device_platform"];
          tenant_id?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          app_version?: string | null;
          created_at?: string;
          device_id?: string | null;
          device_name?: string | null;
          expo_push_token?: string;
          id?: string;
          is_active?: boolean;
          last_seen_at?: string;
          platform?: Database["public"]["Enums"]["device_platform"];
          tenant_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "device_push_tokens_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "device_push_tokens_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      equipment: {
        Row: {
          asset_code: string | null;
          assigned_table_id: string | null;
          category: Database["public"]["Enums"]["equipment_category"];
          created_at: string;
          id: string;
          name: string;
          notes: string | null;
          purchase_price_minor: number | null;
          purchased_at: string | null;
          retired_at: string | null;
          status: Database["public"]["Enums"]["equipment_status"];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          asset_code?: string | null;
          assigned_table_id?: string | null;
          category?: Database["public"]["Enums"]["equipment_category"];
          created_at?: string;
          id?: string;
          name: string;
          notes?: string | null;
          purchase_price_minor?: number | null;
          purchased_at?: string | null;
          retired_at?: string | null;
          status?: Database["public"]["Enums"]["equipment_status"];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          asset_code?: string | null;
          assigned_table_id?: string | null;
          category?: Database["public"]["Enums"]["equipment_category"];
          created_at?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          purchase_price_minor?: number | null;
          purchased_at?: string | null;
          retired_at?: string | null;
          status?: Database["public"]["Enums"]["equipment_status"];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "equipment_table_same_tenant";
            columns: ["tenant_id", "assigned_table_id"];
            isOneToOne: false;
            referencedRelation: "club_tables";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "equipment_table_same_tenant";
            columns: ["tenant_id", "assigned_table_id"];
            isOneToOne: false;
            referencedRelation: "v_club_table_overview";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "equipment_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_categories: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          is_system: boolean;
          name: string;
          sort_order: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          name: string;
          sort_order?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_system?: boolean;
          name?: string;
          sort_order?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_categories_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          amount_minor: number;
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          expense_date: string;
          id: string;
          note: string | null;
          payment_method: Database["public"]["Enums"]["payment_method"];
          receipt_url: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          expense_date: string;
          id?: string;
          note?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          receipt_url?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          expense_date?: string;
          id?: string;
          note?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          receipt_url?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_category_same_tenant";
            columns: ["tenant_id", "category_id"];
            isOneToOne: false;
            referencedRelation: "expense_categories";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_movements: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          movement_type: Database["public"]["Enums"]["inventory_movement_type"];
          note: string | null;
          product_id: string;
          quantity_delta: number;
          reference_id: string | null;
          reference_type: string | null;
          tenant_id: string;
          unit_cost_minor: number | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          movement_type: Database["public"]["Enums"]["inventory_movement_type"];
          note?: string | null;
          product_id: string;
          quantity_delta: number;
          reference_id?: string | null;
          reference_type?: string | null;
          tenant_id: string;
          unit_cost_minor?: number | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          movement_type?: Database["public"]["Enums"]["inventory_movement_type"];
          note?: string | null;
          product_id?: string;
          quantity_delta?: number;
          reference_id?: string | null;
          reference_type?: string | null;
          tenant_id?: string;
          unit_cost_minor?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_product_same_tenant";
            columns: ["tenant_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "inventory_movements_product_same_tenant";
            columns: ["tenant_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "v_low_stock_products";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          body: string | null;
          created_at: string;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          metadata: Json;
          read_at: string | null;
          recipient_user_id: string | null;
          tenant_id: string;
          title: string;
          type: Database["public"]["Enums"]["notification_type"];
        };
        Insert: {
          body?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
          read_at?: string | null;
          recipient_user_id?: string | null;
          tenant_id: string;
          title: string;
          type: Database["public"]["Enums"]["notification_type"];
        };
        Update: {
          body?: string | null;
          created_at?: string;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          metadata?: Json;
          read_at?: string | null;
          recipient_user_id?: string | null;
          tenant_id?: string;
          title?: string;
          type?: Database["public"]["Enums"]["notification_type"];
        };
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_user_id_fkey";
            columns: ["recipient_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          granted_by: string | null;
          is_active: boolean;
          notes: string | null;
          role: Database["public"]["Enums"]["platform_role"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          granted_by?: string | null;
          is_active?: boolean;
          notes?: string | null;
          role?: Database["public"]["Enums"]["platform_role"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          granted_by?: string | null;
          is_active?: boolean;
          notes?: string | null;
          role?: Database["public"]["Enums"]["platform_role"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_admins_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_admins_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      pricing_rules: {
        Row: {
          club_table_id: string | null;
          created_at: string;
          frame_price_minor: number | null;
          id: string;
          increment_minutes: number | null;
          is_active: boolean;
          is_default: boolean;
          minimum_minutes: number;
          name: string;
          pricing_mode: Database["public"]["Enums"]["pricing_mode"];
          rate_minor: number;
          table_type_id: string | null;
          tenant_id: string;
          updated_at: string;
          valid_from: string;
          valid_to: string | null;
        };
        Insert: {
          club_table_id?: string | null;
          created_at?: string;
          frame_price_minor?: number | null;
          id?: string;
          increment_minutes?: number | null;
          is_active?: boolean;
          is_default?: boolean;
          minimum_minutes?: number;
          name: string;
          pricing_mode?: Database["public"]["Enums"]["pricing_mode"];
          rate_minor?: number;
          table_type_id?: string | null;
          tenant_id: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Update: {
          club_table_id?: string | null;
          created_at?: string;
          frame_price_minor?: number | null;
          id?: string;
          increment_minutes?: number | null;
          is_active?: boolean;
          is_default?: boolean;
          minimum_minutes?: number;
          name?: string;
          pricing_mode?: Database["public"]["Enums"]["pricing_mode"];
          rate_minor?: number;
          table_type_id?: string | null;
          tenant_id?: string;
          updated_at?: string;
          valid_from?: string;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "pricing_rules_table_same_tenant";
            columns: ["tenant_id", "club_table_id"];
            isOneToOne: false;
            referencedRelation: "club_tables";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "pricing_rules_table_same_tenant";
            columns: ["tenant_id", "club_table_id"];
            isOneToOne: false;
            referencedRelation: "v_club_table_overview";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "pricing_rules_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pricing_rules_type_same_tenant";
            columns: ["tenant_id", "table_type_id"];
            isOneToOne: false;
            referencedRelation: "table_types";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      product_categories: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          name: string;
          sort_order: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          sort_order?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          sort_order?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_categories_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          category_id: string | null;
          cost_price_minor: number | null;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          low_stock_threshold: number;
          name: string;
          selling_price_minor: number;
          sku: string | null;
          stock_quantity: number;
          tenant_id: string;
          track_inventory: boolean;
          unit: string;
          updated_at: string;
        };
        Insert: {
          category_id?: string | null;
          cost_price_minor?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          low_stock_threshold?: number;
          name: string;
          selling_price_minor: number;
          sku?: string | null;
          stock_quantity?: number;
          tenant_id: string;
          track_inventory?: boolean;
          unit?: string;
          updated_at?: string;
        };
        Update: {
          category_id?: string | null;
          cost_price_minor?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          low_stock_threshold?: number;
          name?: string;
          selling_price_minor?: number;
          sku?: string | null;
          stock_quantity?: number;
          tenant_id?: string;
          track_inventory?: boolean;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_category_same_tenant";
            columns: ["tenant_id", "category_id"];
            isOneToOne: false;
            referencedRelation: "product_categories";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "products_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          last_seen_at: string | null;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          last_seen_at?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          last_seen_at?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      session_items: {
        Row: {
          added_by: string | null;
          created_at: string;
          id: string;
          line_total_minor: number | null;
          note: string | null;
          product_id: string | null;
          product_name_snapshot: string;
          quantity: number;
          session_id: string;
          tenant_id: string;
          unit_price_minor: number;
          updated_at: string;
        };
        Insert: {
          added_by?: string | null;
          created_at?: string;
          id?: string;
          line_total_minor?: number | null;
          note?: string | null;
          product_id?: string | null;
          product_name_snapshot: string;
          quantity: number;
          session_id: string;
          tenant_id: string;
          unit_price_minor: number;
          updated_at?: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          id?: string;
          line_total_minor?: number | null;
          note?: string | null;
          product_id?: string | null;
          product_name_snapshot?: string;
          quantity?: number;
          session_id?: string;
          tenant_id?: string;
          unit_price_minor?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "session_items_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_items_product_same_tenant";
            columns: ["tenant_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "session_items_product_same_tenant";
            columns: ["tenant_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "v_low_stock_products";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "session_items_session_same_tenant";
            columns: ["tenant_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "sessions";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "session_items_session_same_tenant";
            columns: ["tenant_id", "session_id"];
            isOneToOne: false;
            referencedRelation: "v_outstanding_sessions";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "session_items_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      sessions: {
        Row: {
          actual_duration_seconds: number | null;
          billable_duration_seconds: number | null;
          business_date: string;
          created_at: string;
          customer_name: string | null;
          discount_minor: number;
          ended_at: string | null;
          ended_by: string | null;
          frames_played: number;
          id: string;
          items_total_minor: number;
          notes: string | null;
          paid_amount_minor: number;
          paid_at: string | null;
          payment_method: Database["public"]["Enums"]["payment_method"] | null;
          payment_status: Database["public"]["Enums"]["payment_status"];
          planned_duration_minutes: number | null;
          pricing_rule_id: string | null;
          pricing_snapshot: Json;
          started_at: string;
          started_by: string | null;
          status: Database["public"]["Enums"]["session_status"];
          table_charge_minor: number;
          table_id: string;
          tenant_id: string;
          time_completed_at: string | null;
          total_amount_minor: number | null;
          updated_at: string;
        };
        Insert: {
          actual_duration_seconds?: number | null;
          billable_duration_seconds?: number | null;
          business_date?: string;
          created_at?: string;
          customer_name?: string | null;
          discount_minor?: number;
          ended_at?: string | null;
          ended_by?: string | null;
          frames_played?: number;
          id?: string;
          items_total_minor?: number;
          notes?: string | null;
          paid_amount_minor?: number;
          paid_at?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"] | null;
          payment_status?: Database["public"]["Enums"]["payment_status"];
          planned_duration_minutes?: number | null;
          pricing_rule_id?: string | null;
          pricing_snapshot?: Json;
          started_at?: string;
          started_by?: string | null;
          status?: Database["public"]["Enums"]["session_status"];
          table_charge_minor?: number;
          table_id: string;
          tenant_id: string;
          time_completed_at?: string | null;
          total_amount_minor?: number | null;
          updated_at?: string;
        };
        Update: {
          actual_duration_seconds?: number | null;
          billable_duration_seconds?: number | null;
          business_date?: string;
          created_at?: string;
          customer_name?: string | null;
          discount_minor?: number;
          ended_at?: string | null;
          ended_by?: string | null;
          frames_played?: number;
          id?: string;
          items_total_minor?: number;
          notes?: string | null;
          paid_amount_minor?: number;
          paid_at?: string | null;
          payment_method?: Database["public"]["Enums"]["payment_method"] | null;
          payment_status?: Database["public"]["Enums"]["payment_status"];
          planned_duration_minutes?: number | null;
          pricing_rule_id?: string | null;
          pricing_snapshot?: Json;
          started_at?: string;
          started_by?: string | null;
          status?: Database["public"]["Enums"]["session_status"];
          table_charge_minor?: number;
          table_id?: string;
          tenant_id?: string;
          time_completed_at?: string | null;
          total_amount_minor?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_ended_by_fkey";
            columns: ["ended_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_pricing_rule_same_tenant";
            columns: ["tenant_id", "pricing_rule_id"];
            isOneToOne: false;
            referencedRelation: "pricing_rules";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "sessions_started_by_fkey";
            columns: ["started_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sessions_table_same_tenant";
            columns: ["tenant_id", "table_id"];
            isOneToOne: false;
            referencedRelation: "club_tables";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "sessions_table_same_tenant";
            columns: ["tenant_id", "table_id"];
            isOneToOne: false;
            referencedRelation: "v_club_table_overview";
            referencedColumns: ["tenant_id", "id"];
          },
          {
            foreignKeyName: "sessions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      table_types: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          sort_order: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          sort_order?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          sort_order?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "table_types_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_billing_settings: {
        Row: {
          billing_increment_minutes: number;
          created_at: string;
          custom_slabs: Json;
          default_frame_price_minor: number | null;
          frame_billing_enabled: boolean;
          grace_period_minutes: number;
          low_stock_alerts_enabled: boolean;
          minimum_billable_minutes: number;
          notify_on_payment: boolean;
          notify_on_time_completed: boolean;
          overtime_increment_minutes: number | null;
          overtime_mode: Database["public"]["Enums"]["overtime_mode"];
          overtime_rate_minor: number | null;
          rounding_increment_minutes: number;
          rounding_mode: Database["public"]["Enums"]["rounding_mode"];
          tenant_id: string;
          time_calculation_mode: Database["public"]["Enums"]["time_calculation_mode"];
          updated_at: string;
        };
        Insert: {
          billing_increment_minutes?: number;
          created_at?: string;
          custom_slabs?: Json;
          default_frame_price_minor?: number | null;
          frame_billing_enabled?: boolean;
          grace_period_minutes?: number;
          low_stock_alerts_enabled?: boolean;
          minimum_billable_minutes?: number;
          notify_on_payment?: boolean;
          notify_on_time_completed?: boolean;
          overtime_increment_minutes?: number | null;
          overtime_mode?: Database["public"]["Enums"]["overtime_mode"];
          overtime_rate_minor?: number | null;
          rounding_increment_minutes?: number;
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"];
          tenant_id: string;
          time_calculation_mode?: Database["public"]["Enums"]["time_calculation_mode"];
          updated_at?: string;
        };
        Update: {
          billing_increment_minutes?: number;
          created_at?: string;
          custom_slabs?: Json;
          default_frame_price_minor?: number | null;
          frame_billing_enabled?: boolean;
          grace_period_minutes?: number;
          low_stock_alerts_enabled?: boolean;
          minimum_billable_minutes?: number;
          notify_on_payment?: boolean;
          notify_on_time_completed?: boolean;
          overtime_increment_minutes?: number | null;
          overtime_mode?: Database["public"]["Enums"]["overtime_mode"];
          overtime_rate_minor?: number | null;
          rounding_increment_minutes?: number;
          rounding_mode?: Database["public"]["Enums"]["rounding_mode"];
          tenant_id?: string;
          time_calculation_mode?: Database["public"]["Enums"]["time_calculation_mode"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_billing_settings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_memberships: {
        Row: {
          created_at: string;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          joined_at: string | null;
          role: Database["public"]["Enums"]["tenant_role"];
          status: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          joined_at?: string | null;
          role: Database["public"]["Enums"]["tenant_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          invited_at?: string | null;
          invited_by?: string | null;
          joined_at?: string | null;
          role?: Database["public"]["Enums"]["tenant_role"];
          status?: Database["public"]["Enums"]["membership_status"];
          tenant_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tenant_memberships_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          address_line1: string | null;
          address_line2: string | null;
          business_day_cutoff: string;
          city: string | null;
          contact_email: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          country_code: string;
          created_at: string;
          currency_code: string;
          currency_minor_units: number;
          id: string;
          legal_name: string | null;
          logo_url: string | null;
          name: string;
          postal_code: string | null;
          primary_color: string;
          secondary_color: string | null;
          slug: string;
          state: string | null;
          status: Database["public"]["Enums"]["tenant_status"];
          theme_preset: string | null;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          address_line1?: string | null;
          address_line2?: string | null;
          business_day_cutoff?: string;
          city?: string | null;
          contact_email?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          country_code?: string;
          created_at?: string;
          currency_code?: string;
          currency_minor_units?: number;
          id?: string;
          legal_name?: string | null;
          logo_url?: string | null;
          name: string;
          postal_code?: string | null;
          primary_color?: string;
          secondary_color?: string | null;
          slug: string;
          state?: string | null;
          status?: Database["public"]["Enums"]["tenant_status"];
          theme_preset?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          address_line1?: string | null;
          address_line2?: string | null;
          business_day_cutoff?: string;
          city?: string | null;
          contact_email?: string | null;
          contact_name?: string | null;
          contact_phone?: string | null;
          country_code?: string;
          created_at?: string;
          currency_code?: string;
          currency_minor_units?: number;
          id?: string;
          legal_name?: string | null;
          logo_url?: string | null;
          name?: string;
          postal_code?: string | null;
          primary_color?: string;
          secondary_color?: string | null;
          slug?: string;
          state?: string | null;
          status?: Database["public"]["Enums"]["tenant_status"];
          theme_preset?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      v_club_table_overview: {
        Row: {
          active_session_id: string | null;
          active_session_planned_minutes: number | null;
          active_session_started_at: string | null;
          active_session_status:
            Database["public"]["Enums"]["session_status"] | null;
          active_session_total_minor: number | null;
          id: string | null;
          is_active: boolean | null;
          is_occupied: boolean | null;
          name: string | null;
          notes: string | null;
          sort_order: number | null;
          status: Database["public"]["Enums"]["club_table_status"] | null;
          table_number: number | null;
          table_type_code: string | null;
          table_type_id: string | null;
          table_type_name: string | null;
          tenant_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "club_tables_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "club_tables_type_same_tenant";
            columns: ["tenant_id", "table_type_id"];
            isOneToOne: false;
            referencedRelation: "table_types";
            referencedColumns: ["tenant_id", "id"];
          },
        ];
      };
      v_low_stock_products: {
        Row: {
          id: string | null;
          low_stock_threshold: number | null;
          name: string | null;
          selling_price_minor: number | null;
          stock_quantity: number | null;
          tenant_id: string | null;
          unit: string | null;
        };
        Insert: {
          id?: string | null;
          low_stock_threshold?: number | null;
          name?: string | null;
          selling_price_minor?: number | null;
          stock_quantity?: number | null;
          tenant_id?: string | null;
          unit?: string | null;
        };
        Update: {
          id?: string | null;
          low_stock_threshold?: number | null;
          name?: string | null;
          selling_price_minor?: number | null;
          stock_quantity?: number | null;
          tenant_id?: string | null;
          unit?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "products_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      v_outstanding_sessions: {
        Row: {
          business_date: string | null;
          customer_name: string | null;
          ended_at: string | null;
          id: string | null;
          outstanding_minor: number | null;
          paid_amount_minor: number | null;
          payment_status: Database["public"]["Enums"]["payment_status"] | null;
          table_name: string | null;
          tenant_id: string | null;
          total_amount_minor: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "sessions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      add_tenant_member: {
        Args: {
          p_email: string;
          p_role: Database["public"]["Enums"]["tenant_role"];
          p_tenant_id: string;
        };
        Returns: {
          created_at: string;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          joined_at: string | null;
          role: Database["public"]["Enums"]["tenant_role"];
          status: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "tenant_memberships";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      daily_cash_summary: {
        Args: { p_business_date: string; p_tenant_id: string };
        Returns: {
          business_date: string;
          cash_expenses_minor: number;
          cash_received_minor: number;
          non_cash_expenses_minor: number;
          non_cash_received_minor: number;
          outstanding_minor: number;
          sessions_closed: number;
          total_expenses_minor: number;
          total_received_minor: number;
        }[];
      };
      get_user_tenant_id: { Args: never; Returns: string };
      is_platform_admin: { Args: never; Returns: boolean };
      log_activity: {
        Args: {
          p_action: string;
          p_entity_id?: string;
          p_entity_type?: string;
          p_metadata?: Json;
          p_summary?: string;
          p_tenant_id?: string;
        };
        Returns: undefined;
      };
      platform_assign_owner: {
        Args: {
          p_owner_email: string;
          p_replace_existing?: boolean;
          p_tenant_id: string;
        };
        Returns: {
          created_at: string;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          joined_at: string | null;
          role: Database["public"]["Enums"]["tenant_role"];
          status: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "tenant_memberships";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      platform_clubs: {
        Args: never;
        Returns: {
          city: string;
          created_at: string;
          currency_code: string;
          logo_url: string;
          name: string;
          owner_email: string;
          owner_name: string;
          owner_user_id: string;
          primary_color: string;
          slug: string;
          staff_count: number;
          status: Database["public"]["Enums"]["tenant_status"];
          tables_count: number;
          tenant_id: string;
          timezone: string;
        }[];
      };
      platform_create_club: {
        Args: {
          p_address_line1?: string;
          p_city?: string;
          p_contact_email?: string;
          p_contact_name?: string;
          p_contact_phone?: string;
          p_currency_code?: string;
          p_logo_url?: string;
          p_name: string;
          p_owner_email: string;
          p_primary_color?: string;
          p_secondary_color?: string;
          p_slug: string;
          p_state?: string;
          p_status?: Database["public"]["Enums"]["tenant_status"];
          p_theme_preset?: string;
          p_timezone?: string;
        };
        Returns: {
          address_line1: string | null;
          address_line2: string | null;
          business_day_cutoff: string;
          city: string | null;
          contact_email: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          country_code: string;
          created_at: string;
          currency_code: string;
          currency_minor_units: number;
          id: string;
          legal_name: string | null;
          logo_url: string | null;
          name: string;
          postal_code: string | null;
          primary_color: string;
          secondary_color: string | null;
          slug: string;
          state: string | null;
          status: Database["public"]["Enums"]["tenant_status"];
          theme_preset: string | null;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "tenants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      platform_create_tenant: {
        Args: {
          p_currency_code?: string;
          p_name: string;
          p_primary_color?: string;
          p_secondary_color?: string;
          p_slug: string;
          p_status?: Database["public"]["Enums"]["tenant_status"];
          p_timezone?: string;
        };
        Returns: {
          address_line1: string | null;
          address_line2: string | null;
          business_day_cutoff: string;
          city: string | null;
          contact_email: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          country_code: string;
          created_at: string;
          currency_code: string;
          currency_minor_units: number;
          id: string;
          legal_name: string | null;
          logo_url: string | null;
          name: string;
          postal_code: string | null;
          primary_color: string;
          secondary_color: string | null;
          slug: string;
          state: string | null;
          status: Database["public"]["Enums"]["tenant_status"];
          theme_preset: string | null;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "tenants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      platform_overview: {
        Args: never;
        Returns: {
          active_clubs: number;
          archived_clubs: number;
          clubs_count: number;
          clubs_without_owner: number;
          owners_count: number;
          staff_count: number;
          suspended_clubs: number;
          trial_clubs: number;
        }[];
      };
      platform_owner_clubs: {
        Args: { p_owner_user_id: string };
        Returns: {
          city: string;
          created_at: string;
          currency_code: string;
          logo_url: string;
          name: string;
          primary_color: string;
          slug: string;
          staff_count: number;
          status: Database["public"]["Enums"]["tenant_status"];
          tables_count: number;
          tenant_id: string;
          timezone: string;
        }[];
      };
      platform_owners: {
        Args: never;
        Returns: {
          active_clubs: number;
          clubs_count: number;
          email: string;
          full_name: string;
          is_active: boolean;
          joined_at: string;
          phone: string;
          user_id: string;
        }[];
      };
      platform_set_owner_active: {
        Args: { p_is_active: boolean; p_owner_user_id: string };
        Returns: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          last_seen_at: string | null;
          phone: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      platform_set_tenant_status: {
        Args: {
          p_status: Database["public"]["Enums"]["tenant_status"];
          p_tenant_id: string;
        };
        Returns: {
          address_line1: string | null;
          address_line2: string | null;
          business_day_cutoff: string;
          city: string | null;
          contact_email: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          country_code: string;
          created_at: string;
          currency_code: string;
          currency_minor_units: number;
          id: string;
          legal_name: string | null;
          logo_url: string | null;
          name: string;
          postal_code: string | null;
          primary_color: string;
          secondary_color: string | null;
          slug: string;
          state: string | null;
          status: Database["public"]["Enums"]["tenant_status"];
          theme_preset: string | null;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "tenants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      platform_update_tenant: {
        Args: {
          p_address_line1?: string;
          p_city?: string;
          p_clear_logo?: boolean;
          p_contact_email?: string;
          p_contact_name?: string;
          p_contact_phone?: string;
          p_currency_code?: string;
          p_logo_url?: string;
          p_name?: string;
          p_primary_color?: string;
          p_secondary_color?: string;
          p_state?: string;
          p_tenant_id: string;
          p_theme_preset?: string;
          p_timezone?: string;
        };
        Returns: {
          address_line1: string | null;
          address_line2: string | null;
          business_day_cutoff: string;
          city: string | null;
          contact_email: string | null;
          contact_name: string | null;
          contact_phone: string | null;
          country_code: string;
          created_at: string;
          currency_code: string;
          currency_minor_units: number;
          id: string;
          legal_name: string | null;
          logo_url: string | null;
          name: string;
          postal_code: string | null;
          primary_color: string;
          secondary_color: string | null;
          slug: string;
          state: string | null;
          status: Database["public"]["Enums"]["tenant_status"];
          theme_preset: string | null;
          timezone: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "tenants";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      report_daily_revenue: {
        Args: { p_from: string; p_tenant_id: string; p_to: string };
        Returns: {
          business_date: string;
          collected_minor: number;
          expenses_minor: number;
          net_minor: number;
          sessions_count: number;
        }[];
      };
      report_expense_breakdown: {
        Args: { p_from: string; p_tenant_id: string; p_to: string };
        Returns: {
          category_id: string;
          category_name: string;
          entries_count: number;
          total_minor: number;
        }[];
      };
      report_product_sales: {
        Args: { p_from: string; p_tenant_id: string; p_to: string };
        Returns: {
          product_id: string;
          product_name: string;
          quantity_sold: number;
          revenue_minor: number;
        }[];
      };
      report_revenue_summary: {
        Args: { p_from: string; p_tenant_id: string; p_to: string };
        Returns: {
          average_session_minor: number;
          billed_seconds: number;
          cash_minor: number;
          collected_minor: number;
          discount_minor: number;
          gross_minor: number;
          items_minor: number;
          non_cash_minor: number;
          outstanding_minor: number;
          played_seconds: number;
          sessions_count: number;
          table_charge_minor: number;
        }[];
      };
      report_table_performance: {
        Args: { p_from: string; p_tenant_id: string; p_to: string };
        Returns: {
          collected_minor: number;
          played_seconds: number;
          sessions_count: number;
          table_id: string;
          table_name: string;
          table_type_name: string;
        }[];
      };
      set_membership_status: {
        Args: {
          p_membership_id: string;
          p_status: Database["public"]["Enums"]["membership_status"];
        };
        Returns: {
          created_at: string;
          id: string;
          invited_at: string | null;
          invited_by: string | null;
          joined_at: string | null;
          role: Database["public"]["Enums"]["tenant_role"];
          status: Database["public"]["Enums"]["membership_status"];
          tenant_id: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "tenant_memberships";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      tenant_activity: {
        Args: { p_limit?: number; p_tenant_id: string };
        Returns: {
          action: string;
          actor_email: string;
          actor_name: string;
          actor_role: string;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: number;
          metadata: Json;
          summary: string;
        }[];
      };
      tenant_staff: {
        Args: { p_tenant_id: string };
        Returns: {
          account_active: boolean;
          avatar_url: string;
          created_at: string;
          email: string;
          full_name: string;
          joined_at: string;
          last_seen_at: string;
          membership_id: string;
          phone: string;
          role: Database["public"]["Enums"]["tenant_role"];
          status: Database["public"]["Enums"]["membership_status"];
          user_id: string;
        }[];
      };
    };
    Enums: {
      cash_closing_status: "OPEN" | "CLOSED";
      club_table_status: "AVAILABLE" | "MAINTENANCE" | "OUT_OF_SERVICE";
      device_platform: "IOS" | "ANDROID" | "WEB";
      equipment_category:
        | "CUE"
        | "REST_CUE"
        | "BALL_SET"
        | "CHALK"
        | "GLOVE"
        | "TABLE_ACCESSORY"
        | "FURNITURE"
        | "OTHER";
      equipment_status:
        "AVAILABLE" | "IN_USE" | "NEEDS_REPAIR" | "DAMAGED" | "RETIRED";
      inventory_movement_type:
        | "OPENING_BALANCE"
        | "PURCHASE"
        | "SALE"
        | "RETURN"
        | "DAMAGE"
        | "ADJUSTMENT"
        | "CORRECTION";
      membership_status: "INVITED" | "ACTIVE" | "DISABLED";
      notification_type:
        | "SESSION_STARTED"
        | "SESSION_TIME_COMPLETED"
        | "SESSION_CLOSED"
        | "PAYMENT_RECEIVED"
        | "LOW_STOCK"
        | "CASH_CLOSING_REMINDER"
        | "SYSTEM_ALERT";
      overtime_mode: "SAME_RATE" | "OVERTIME_RATE" | "INCREMENT_BLOCK" | "FREE";
      payment_method:
        "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "WALLET" | "OTHER";
      payment_status: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "WAIVED";
      platform_role: "SUPER_ADMIN" | "SUPPORT";
      pricing_mode:
        | "PER_MINUTE"
        | "PER_HOUR"
        | "FIXED_INCREMENT"
        | "PER_FRAME"
        | "FLAT_SESSION";
      rounding_mode: "EXACT" | "ROUND_UP" | "ROUND_DOWN" | "NEAREST";
      session_status: "ACTIVE" | "TIME_COMPLETED" | "CLOSED" | "CANCELLED";
      tenant_role: "OWNER" | "RECEPTIONIST";
      tenant_status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "ARCHIVED";
      time_calculation_mode:
        "PER_MINUTE" | "PER_HOUR" | "FIXED_INCREMENT" | "CUSTOM_SLABS";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      cash_closing_status: ["OPEN", "CLOSED"],
      club_table_status: ["AVAILABLE", "MAINTENANCE", "OUT_OF_SERVICE"],
      device_platform: ["IOS", "ANDROID", "WEB"],
      equipment_category: [
        "CUE",
        "REST_CUE",
        "BALL_SET",
        "CHALK",
        "GLOVE",
        "TABLE_ACCESSORY",
        "FURNITURE",
        "OTHER",
      ],
      equipment_status: [
        "AVAILABLE",
        "IN_USE",
        "NEEDS_REPAIR",
        "DAMAGED",
        "RETIRED",
      ],
      inventory_movement_type: [
        "OPENING_BALANCE",
        "PURCHASE",
        "SALE",
        "RETURN",
        "DAMAGE",
        "ADJUSTMENT",
        "CORRECTION",
      ],
      membership_status: ["INVITED", "ACTIVE", "DISABLED"],
      notification_type: [
        "SESSION_STARTED",
        "SESSION_TIME_COMPLETED",
        "SESSION_CLOSED",
        "PAYMENT_RECEIVED",
        "LOW_STOCK",
        "CASH_CLOSING_REMINDER",
        "SYSTEM_ALERT",
      ],
      overtime_mode: ["SAME_RATE", "OVERTIME_RATE", "INCREMENT_BLOCK", "FREE"],
      payment_method: [
        "CASH",
        "UPI",
        "CARD",
        "BANK_TRANSFER",
        "WALLET",
        "OTHER",
      ],
      payment_status: ["UNPAID", "PARTIALLY_PAID", "PAID", "WAIVED"],
      platform_role: ["SUPER_ADMIN", "SUPPORT"],
      pricing_mode: [
        "PER_MINUTE",
        "PER_HOUR",
        "FIXED_INCREMENT",
        "PER_FRAME",
        "FLAT_SESSION",
      ],
      rounding_mode: ["EXACT", "ROUND_UP", "ROUND_DOWN", "NEAREST"],
      session_status: ["ACTIVE", "TIME_COMPLETED", "CLOSED", "CANCELLED"],
      tenant_role: ["OWNER", "RECEPTIONIST"],
      tenant_status: ["TRIAL", "ACTIVE", "SUSPENDED", "ARCHIVED"],
      time_calculation_mode: [
        "PER_MINUTE",
        "PER_HOUR",
        "FIXED_INCREMENT",
        "CUSTOM_SLABS",
      ],
    },
  },
} as const;
