
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "alert_events": {
                  Row: {
                    "acknowledged_at": string | null,"created_at": string,"department_id": string | null,"id": string,"mention_id": string | null,"org_id": string,"payload": NonNullable<Json>,"rule_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string | null,"created_at"?: string,"department_id"?: string | null,"id"?: string,"mention_id"?: string | null,"org_id": string,"payload"?: NonNullable<Json>,"rule_id": string
                  }
                  Update: {
                    "acknowledged_at"?: string | null,"created_at"?: string,"department_id"?: string | null,"id"?: string,"mention_id"?: string | null,"org_id"?: string,"payload"?: NonNullable<Json>,"rule_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alert_events_org_id_department_id_fkey"
      columns: ["org_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "alert_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "alert_events_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "alert_events_org_id_rule_id_fkey"
      columns: ["org_id","rule_id"]
isOneToOne: false
      referencedRelation: "alert_rules"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"alert_rules": {
                  Row: {
                    "channels": NonNullable<Json>,"condition": NonNullable<Json>,"created_at": string,"department_id": string | null,"id": string,"is_active": boolean,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channels"?: NonNullable<Json>,"condition": NonNullable<Json>,"created_at"?: string,"department_id"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"org_id": string
                  }
                  Update: {
                    "channels"?: NonNullable<Json>,"condition"?: NonNullable<Json>,"created_at"?: string,"department_id"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "alert_rules_org_id_department_id_fkey"
      columns: ["org_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "alert_rules_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"authors": {
                  Row: {
                    "created_at": string,"display_name": string | null,"followers": number | null,"handle": string,"id": string,"kind": Database["public"]['Enums']["author_kind"],"org_id": string,"platform": Database["public"]['Enums']["source_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"followers"?: number | null,"handle": string,"id"?: string,"kind"?: Database["public"]['Enums']["author_kind"],"org_id": string,"platform": Database["public"]['Enums']["source_type"]
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"followers"?: number | null,"handle"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["author_kind"],"org_id"?: string,"platform"?: Database["public"]['Enums']["source_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "authors_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"classifications": {
                  Row: {
                    "confidence": number | null,"corrected_by": string | null,"created_at": string,"department_id": string | null,"emotion": string | null,"id": string,"intent": string | null,"mention_id": string,"model": string,"neighborhood_id": string | null,"org_id": string,"priority": Database["public"]['Enums']["priority"],"sentiment": Database["public"]['Enums']["sentiment"],"topic": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "confidence"?: number | null,"corrected_by"?: string | null,"created_at"?: string,"department_id"?: string | null,"emotion"?: string | null,"id"?: string,"intent"?: string | null,"mention_id": string,"model": string,"neighborhood_id"?: string | null,"org_id": string,"priority"?: Database["public"]['Enums']["priority"],"sentiment": Database["public"]['Enums']["sentiment"],"topic"?: string | null
                  }
                  Update: {
                    "confidence"?: number | null,"corrected_by"?: string | null,"created_at"?: string,"department_id"?: string | null,"emotion"?: string | null,"id"?: string,"intent"?: string | null,"mention_id"?: string,"model"?: string,"neighborhood_id"?: string | null,"org_id"?: string,"priority"?: Database["public"]['Enums']["priority"],"sentiment"?: Database["public"]['Enums']["sentiment"],"topic"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "classifications_org_id_department_id_fkey"
      columns: ["org_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "classifications_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "classifications_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "classifications_org_id_neighborhood_id_fkey"
      columns: ["org_id","neighborhood_id"]
isOneToOne: false
      referencedRelation: "neighborhoods"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string,"short_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string,"short_name"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"short_name"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "departments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"department_id": string | null,"id": string,"org_id": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"department_id"?: string | null,"id"?: string,"org_id": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"department_id"?: string | null,"id"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["membership_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_department_id_fkey"
      columns: ["org_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"mentions": {
                  Row: {
                    "author_id": string | null,"created_at": string,"external_id": string,"id": string,"metrics": NonNullable<Json>,"org_id": string,"published_at": string,"query_id": string | null,"search": unknown,"source_id": string,"status": Database["public"]['Enums']["mention_status"],"text": string,"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"created_at"?: string,"external_id": string,"id"?: string,"metrics"?: NonNullable<Json>,"org_id": string,"published_at": string,"query_id"?: string | null,"search"?: never,"source_id": string,"status"?: Database["public"]['Enums']["mention_status"],"text": string,"url"?: string | null
                  }
                  Update: {
                    "author_id"?: string | null,"created_at"?: string,"external_id"?: string,"id"?: string,"metrics"?: NonNullable<Json>,"org_id"?: string,"published_at"?: string,"query_id"?: string | null,"search"?: never,"source_id"?: string,"status"?: Database["public"]['Enums']["mention_status"],"text"?: string,"url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "mentions_org_id_author_id_fkey"
      columns: ["org_id","author_id"]
isOneToOne: false
      referencedRelation: "authors"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "mentions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mentions_org_id_query_id_fkey"
      columns: ["org_id","query_id"]
isOneToOne: false
      referencedRelation: "queries"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "mentions_org_id_source_id_fkey"
      columns: ["org_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"neighborhoods": {
                  Row: {
                    "created_at": string,"geojson": Json | null,"id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"geojson"?: Json | null,"id"?: string,"name": string,"org_id": string
                  }
                  Update: {
                    "created_at"?: string,"geojson"?: Json | null,"id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "neighborhoods_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"slug": string,"state": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"slug": string,"state"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"state"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"projects": {
                  Row: {
                    "created_at": string,"goal": string | null,"id": string,"kpis": NonNullable<Json>,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"goal"?: string | null,"id"?: string,"kpis"?: NonNullable<Json>,"name": string,"org_id": string
                  }
                  Update: {
                    "created_at"?: string,"goal"?: string | null,"id"?: string,"kpis"?: NonNullable<Json>,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "projects_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"queries": {
                  Row: {
                    "created_at": string,"expression": string,"filters": NonNullable<Json>,"id": string,"is_active": boolean,"name": string,"org_id": string,"project_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expression": string,"filters"?: NonNullable<Json>,"id"?: string,"is_active"?: boolean,"name": string,"org_id": string,"project_id": string,"version"?: number
                  }
                  Update: {
                    "created_at"?: string,"expression"?: string,"filters"?: NonNullable<Json>,"id"?: string,"is_active"?: boolean,"name"?: string,"org_id"?: string,"project_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "queries_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "queries_org_id_project_id_fkey"
      columns: ["org_id","project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "content": NonNullable<Json>,"created_at": string,"id": string,"org_id": string,"pdf_path": string | null,"period": Database["public"]['Enums']["report_period"],"period_end": string,"period_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"org_id": string,"pdf_path"?: string | null,"period": Database["public"]['Enums']["report_period"],"period_end": string,"period_start": string
                  }
                  Update: {
                    "content"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"org_id"?: string,"pdf_path"?: string | null,"period"?: Database["public"]['Enums']["report_period"],"period_end"?: string,"period_start"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"sources": {
                  Row: {
                    "config": NonNullable<Json>,"created_at": string,"id": string,"is_active": boolean,"last_run_at": string | null,"name": string,"org_id": string,"type": Database["public"]['Enums']["source_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"is_active"?: boolean,"last_run_at"?: string | null,"name": string,"org_id": string,"type": Database["public"]['Enums']["source_type"]
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"is_active"?: boolean,"last_run_at"?: string | null,"name"?: string,"org_id"?: string,"type"?: Database["public"]['Enums']["source_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "sources_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"tickets": {
                  Row: {
                    "assignee_id": string | null,"created_at": string,"department_id": string,"due_at": string | null,"id": string,"mention_id": string,"org_id": string,"resolved_at": string | null,"status": Database["public"]['Enums']["ticket_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"created_at"?: string,"department_id": string,"due_at"?: string | null,"id"?: string,"mention_id": string,"org_id": string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"]
                  }
                  Update: {
                    "assignee_id"?: string | null,"created_at"?: string,"department_id"?: string,"due_at"?: string | null,"id"?: string,"mention_id"?: string,"org_id"?: string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "tickets_org_id_department_id_fkey"
      columns: ["org_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "tickets_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "tickets_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    }
                  ]
                }
          }
          Views: {
            "mention_stats_hourly": {
                  Row: {
                    "department_id": string | null,"hour": string | null,"interactions": number | null,"mentions": number | null,"org_id": string | null,"sentiment": Database["public"]['Enums']["sentiment"] | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "mentions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "mention_stats":
{ Args: { "p_from": string,"p_org_id": string,"p_to": string }; Returns: {
              "department_id": string,"hour": string,"interactions": number,"mentions": number,"sentiment": Database["public"]['Enums']["sentiment"]
            }[]
                           },
"org_members":
{ Args: { "p_org_id": string }; Returns: {
              "department_id": string,"department_name": string,"email": string,"invited_at": string,"last_sign_in_at": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
            }[]
                           }
          }
          Enums: {
            "author_kind": "media"|"public_figure"|"citizen","membership_role": "admin"|"comunicacion"|"dependencia"|"lectura","mention_status": "pending"|"classified"|"failed","priority": "low"|"medium"|"high"|"critical","report_period": "daily"|"weekly"|"monthly","sentiment": "positive"|"neutral"|"negative","source_type": "meta"|"rss"|"youtube"|"x","ticket_status": "open"|"in_progress"|"resolved"|"closed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "author_kind": ["media", "public_figure", "citizen"],"membership_role": ["admin", "comunicacion", "dependencia", "lectura"],"mention_status": ["pending", "classified", "failed"],"priority": ["low", "medium", "high", "critical"],"report_period": ["daily", "weekly", "monthly"],"sentiment": ["positive", "neutral", "negative"],"source_type": ["meta", "rss", "youtube", "x"],"ticket_status": ["open", "in_progress", "resolved", "closed"]
          }
        }
} as const
