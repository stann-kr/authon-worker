export interface Database {
  public: {
    Tables: {
      venues: {
        Row: {
          id: string;
          name: string;
          type: 'club' | 'bar' | 'lounge' | 'festival' | 'private';
          address: string | null;
          description: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          type?: 'club' | 'bar' | 'lounge' | 'festival' | 'private';
          address?: string | null;
          description?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          type?: 'club' | 'bar' | 'lounge' | 'festival' | 'private';
          address?: string | null;
          description?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      users: {
        Row: {
          id: string;
          auth_user_id: string | null;
          venue_id: string | null;
          email: string;
          name: string;
          role: 'super_admin' | 'venue_admin' | 'door_staff' | 'staff' | 'dj';
          guest_limit: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          auth_user_id?: string | null;
          venue_id: string;
          email: string;
          name: string;
          role: 'super_admin' | 'venue_admin' | 'door_staff' | 'staff' | 'dj';
          guest_limit?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          auth_user_id?: string | null;
          venue_id?: string;
          email?: string;
          name?: string;
          role?: 'super_admin' | 'venue_admin' | 'door_staff' | 'staff' | 'dj';
          guest_limit?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      djs: {
        Row: {
          id: string;
          venue_id: string;
          user_id: string | null;
          name: string;
          event: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          venue_id: string;
          user_id?: string | null;
          name: string;
          event: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          venue_id?: string;
          user_id?: string | null;
          name?: string;
          event?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      external_dj_links: {
        Row: {
          id: string;
          venue_id: string;
          token: string;
          dj_name: string;
          event: string;
          date: string;
          max_guests: number;
          used_guests: number;
          active: boolean;
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          venue_id: string;
          token?: string;
          dj_name: string;
          event: string;
          date: string;
          max_guests?: number;
          used_guests?: number;
          active?: boolean;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          venue_id?: string;
          token?: string;
          dj_name?: string;
          event?: string;
          date?: string;
          max_guests?: number;
          used_guests?: number;
          active?: boolean;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      guests: {
        Row: {
          id: string;
          venue_id: string;
          name: string;
          dj_id: string | null;
          external_link_id: string | null;
          created_by_user_id: string | null;
          status: 'pending' | 'checked' | 'deleted';
          check_in_time: string | null;
          date: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          venue_id: string;
          name: string;
          dj_id?: string | null;
          external_link_id?: string | null;
          created_by_user_id?: string | null;
          status?: 'pending' | 'checked' | 'deleted';
          check_in_time?: string | null;
          date: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          venue_id?: string;
          name?: string;
          dj_id?: string | null;
          external_link_id?: string | null;
          created_by_user_id?: string | null;
          status?: 'pending' | 'checked' | 'deleted';
          check_in_time?: string | null;
          date?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
