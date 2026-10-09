
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ai_usage": {
                  Row: {
                    "cache_read_tokens": number,"cache_write_tokens": number,"cost_usd": number,"created_at": string,"day": string,"id": string,"input_tokens": number,"model": string,"org_id": string,"output_tokens": number,"purpose": string,"requests": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"day": string,"id"?: string,"input_tokens"?: number,"model": string,"org_id": string,"output_tokens"?: number,"purpose": string,"requests"?: number
                  }
                  Update: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"day"?: string,"id"?: string,"input_tokens"?: number,"model"?: string,"org_id"?: string,"output_tokens"?: number,"purpose"?: string,"requests"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"alert_events": {
                  Row: {
                    "acknowledged_at": string | null,"created_at": string,"department_id": string | null,"feedback": string | null,"feedback_at": string | null,"feedback_by": string | null,"fingerprint": string | null,"id": string,"kind": string | null,"mention_id": string | null,"mention_ids": (string)[],"notifications": NonNullable<Json>,"org_id": string,"payload": NonNullable<Json>,"rule_id": string,"severity": Database["public"]['Enums']["priority"],"summary": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string | null,"created_at"?: string,"department_id"?: string | null,"feedback"?: string | null,"feedback_at"?: string | null,"feedback_by"?: string | null,"fingerprint"?: string | null,"id"?: string,"kind"?: string | null,"mention_id"?: string | null,"mention_ids"?: (string)[],"notifications"?: NonNullable<Json>,"org_id": string,"payload"?: NonNullable<Json>,"rule_id": string,"severity"?: Database["public"]['Enums']["priority"],"summary"?: string,"title"?: string
                  }
                  Update: {
                    "acknowledged_at"?: string | null,"created_at"?: string,"department_id"?: string | null,"feedback"?: string | null,"feedback_at"?: string | null,"feedback_by"?: string | null,"fingerprint"?: string | null,"id"?: string,"kind"?: string | null,"mention_id"?: string | null,"mention_ids"?: (string)[],"notifications"?: NonNullable<Json>,"org_id"?: string,"payload"?: NonNullable<Json>,"rule_id"?: string,"severity"?: Database["public"]['Enums']["priority"],"summary"?: string,"title"?: string
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
                    "channels": NonNullable<Json>,"condition": NonNullable<Json>,"cooldown_minutes": number,"created_at": string,"department_id": string | null,"id": string,"is_active": boolean,"kind": string,"name": string,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channels"?: NonNullable<Json>,"condition": NonNullable<Json>,"cooldown_minutes"?: number,"created_at"?: string,"department_id"?: string | null,"id"?: string,"is_active"?: boolean,"kind"?: string,"name": string,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "channels"?: NonNullable<Json>,"condition"?: NonNullable<Json>,"cooldown_minutes"?: number,"created_at"?: string,"department_id"?: string | null,"id"?: string,"is_active"?: boolean,"kind"?: string,"name"?: string,"org_id"?: string,"updated_at"?: string
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
                    "confidence": number | null,"corrected_at": string | null,"corrected_by": string | null,"created_at": string,"department_id": string | null,"emotion": string | null,"id": string,"intent": string | null,"mention_id": string,"model": string,"neighborhood_id": string | null,"org_id": string,"priority": Database["public"]['Enums']["priority"],"sentiment": Database["public"]['Enums']["sentiment"],"topic": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "confidence"?: number | null,"corrected_at"?: string | null,"corrected_by"?: string | null,"created_at"?: string,"department_id"?: string | null,"emotion"?: string | null,"id"?: string,"intent"?: string | null,"mention_id": string,"model": string,"neighborhood_id"?: string | null,"org_id": string,"priority"?: Database["public"]['Enums']["priority"],"sentiment": Database["public"]['Enums']["sentiment"],"topic"?: string | null
                  }
                  Update: {
                    "confidence"?: number | null,"corrected_at"?: string | null,"corrected_by"?: string | null,"created_at"?: string,"department_id"?: string | null,"emotion"?: string | null,"id"?: string,"intent"?: string | null,"mention_id"?: string,"model"?: string,"neighborhood_id"?: string | null,"org_id"?: string,"priority"?: Database["public"]['Enums']["priority"],"sentiment"?: Database["public"]['Enums']["sentiment"],"topic"?: string | null
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
                },"crisis_log": {
                  Row: {
                    "alert_event_id": string | null,"author_id": string,"author_name": string,"body": string,"created_at": string,"id": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alert_event_id"?: string | null,"author_id"?: string,"author_name"?: string,"body": string,"created_at"?: string,"id"?: string,"org_id": string
                  }
                  Update: {
                    "alert_event_id"?: string | null,"author_id"?: string,"author_name"?: string,"body"?: string,"created_at"?: string,"id"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "crisis_log_alert_event_id_fkey"
      columns: ["alert_event_id"]
isOneToOne: false
      referencedRelation: "alert_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "crisis_log_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
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
                },"ingest_runs": {
                  Row: {
                    "created_at": string,"duplicates": number,"error": string | null,"fetched": number,"finished_at": string,"id": string,"inserted": number,"org_id": string,"source_id": string,"started_at": string,"status": string,"trigger": string,"unmatched": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"duplicates"?: number,"error"?: string | null,"fetched"?: number,"finished_at"?: string,"id"?: string,"inserted"?: number,"org_id": string,"source_id": string,"started_at": string,"status": string,"trigger": string,"unmatched"?: number
                  }
                  Update: {
                    "created_at"?: string,"duplicates"?: number,"error"?: string | null,"fetched"?: number,"finished_at"?: string,"id"?: string,"inserted"?: number,"org_id"?: string,"source_id"?: string,"started_at"?: string,"status"?: string,"trigger"?: string,"unmatched"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ingest_runs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ingest_runs_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
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
                },"mention_notes": {
                  Row: {
                    "author_id": string,"author_name": string,"body": string,"created_at": string,"id": string,"mention_id": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string,"author_name"?: string,"body": string,"created_at"?: string,"id"?: string,"mention_id": string,"org_id": string
                  }
                  Update: {
                    "author_id"?: string,"author_name"?: string,"body"?: string,"created_at"?: string,"id"?: string,"mention_id"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "mention_notes_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "mention_notes_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"mentions": {
                  Row: {
                    "author_id": string | null,"created_at": string,"external_id": string,"id": string,"metrics": NonNullable<Json>,"org_id": string,"published_at": string,"query_id": string | null,"search": unknown,"source_id": string,"status": Database["public"]['Enums']["mention_status"],"text": string,"triage": Database["public"]['Enums']["triage_status"],"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"created_at"?: string,"external_id": string,"id"?: string,"metrics"?: NonNullable<Json>,"org_id": string,"published_at": string,"query_id"?: string | null,"search"?: never,"source_id": string,"status"?: Database["public"]['Enums']["mention_status"],"text": string,"triage"?: Database["public"]['Enums']["triage_status"],"url"?: string | null
                  }
                  Update: {
                    "author_id"?: string | null,"created_at"?: string,"external_id"?: string,"id"?: string,"metrics"?: NonNullable<Json>,"org_id"?: string,"published_at"?: string,"query_id"?: string | null,"search"?: never,"source_id"?: string,"status"?: Database["public"]['Enums']["mention_status"],"text"?: string,"triage"?: Database["public"]['Enums']["triage_status"],"url"?: string | null
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
                    "classification_rules": string,"created_at": string,"goal": string | null,"id": string,"kpis": NonNullable<Json>,"name": string,"org_id": string,"territory": NonNullable<Json>,"topics": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "classification_rules"?: string,"created_at"?: string,"goal"?: string | null,"id"?: string,"kpis"?: NonNullable<Json>,"name": string,"org_id": string,"territory"?: NonNullable<Json>,"topics"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "classification_rules"?: string,"created_at"?: string,"goal"?: string | null,"id"?: string,"kpis"?: NonNullable<Json>,"name"?: string,"org_id"?: string,"territory"?: NonNullable<Json>,"topics"?: (string)[],"updated_at"?: string
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
                    "builder": Json | null,"created_at": string,"created_by": string | null,"expression": string,"filters": NonNullable<Json>,"id": string,"is_active": boolean,"lineage_id": string,"name": string,"org_id": string,"project_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "builder"?: Json | null,"created_at"?: string,"created_by"?: string | null,"expression": string,"filters"?: NonNullable<Json>,"id"?: string,"is_active"?: boolean,"lineage_id"?: string,"name": string,"org_id": string,"project_id": string,"version"?: number
                  }
                  Update: {
                    "builder"?: Json | null,"created_at"?: string,"created_by"?: string | null,"expression"?: string,"filters"?: NonNullable<Json>,"id"?: string,"is_active"?: boolean,"lineage_id"?: string,"name"?: string,"org_id"?: string,"project_id"?: string,"version"?: number
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
                },"risk_terms": {
                  Row: {
                    "created_at": string,"id": string,"normalized": string,"org_id": string,"severity": Database["public"]['Enums']["priority"],"term": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"normalized": string,"org_id": string,"severity"?: Database["public"]['Enums']["priority"],"term": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"normalized"?: string,"org_id"?: string,"severity"?: Database["public"]['Enums']["priority"],"term"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "risk_terms_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"sources": {
                  Row: {
                    "config": NonNullable<Json>,"consecutive_failures": number,"created_at": string,"cursor": NonNullable<Json>,"has_secret": boolean,"id": string,"is_active": boolean,"last_error": string | null,"last_error_at": string | null,"last_run_at": string | null,"last_success_at": string | null,"name": string,"org_id": string,"type": Database["public"]['Enums']["source_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"consecutive_failures"?: number,"created_at"?: string,"cursor"?: NonNullable<Json>,"has_secret"?: boolean,"id"?: string,"is_active"?: boolean,"last_error"?: string | null,"last_error_at"?: string | null,"last_run_at"?: string | null,"last_success_at"?: string | null,"name": string,"org_id": string,"type": Database["public"]['Enums']["source_type"]
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"consecutive_failures"?: number,"created_at"?: string,"cursor"?: NonNullable<Json>,"has_secret"?: boolean,"id"?: string,"is_active"?: boolean,"last_error"?: string | null,"last_error_at"?: string | null,"last_run_at"?: string | null,"last_success_at"?: string | null,"name"?: string,"org_id"?: string,"type"?: Database["public"]['Enums']["source_type"]
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
                    "assignee_id": string | null,"created_at": string,"created_by": string | null,"department_id": string,"due_at": string | null,"id": string,"mention_id": string,"org_id": string,"resolved_at": string | null,"status": Database["public"]['Enums']["ticket_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "assignee_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"department_id": string,"due_at"?: string | null,"id"?: string,"mention_id": string,"org_id": string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"]
                  }
                  Update: {
                    "assignee_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"department_id"?: string,"due_at"?: string | null,"id"?: string,"mention_id"?: string,"org_id"?: string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"]
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
                    "complaint": boolean | null,"department_id": string | null,"hour": string | null,"interactions": number | null,"mentions": number | null,"neighborhood_id": string | null,"org_id": string | null,"sentiment": Database["public"]['Enums']["sentiment"] | null,"topic": string | null
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
            "alert_candidates":
{ Args: { "p_department_id"?: string,"p_org_id": string,"p_since": string }; Returns: {
              "author_id": string,"author_kind": Database["public"]['Enums']["author_kind"],"author_name": string,"max_severity": Database["public"]['Enums']["priority"],"mention_id": string,"priority": Database["public"]['Enums']["priority"],"published_at": string,"sentiment": Database["public"]['Enums']["sentiment"],"terms": (string)[],"text": string
            }[]
                           },
"alert_digest":
{ Args: { "p_department_id"?: string,"p_from": string,"p_org_id": string,"p_to": string }; Returns: Json
                           },
"alert_sentiment_window":
{ Args: { "p_baseline_days": number,"p_department_id"?: string,"p_org_id": string,"p_window_minutes": number }; Returns: {
              "baseline_classified": number,"baseline_nss": number,"current_classified": number,"current_nss": number
            }[]
                           },
"alert_volume_window":
{ Args: { "p_baseline_days": number,"p_department_id"?: string,"p_org_id": string,"p_window_minutes": number }; Returns: {
              "baseline_mean": number,"baseline_stddev": number,"baseline_windows": number,"current_count": number
            }[]
                           },
"clear_source_secret":
{ Args: { "p_source_id": string }; Returns: undefined
                           },
"crisis_snapshot":
{ Args: { "p_minutes"?: number,"p_org_id": string }; Returns: Json
                           },
"dashboard_stats":
{ Args: { "p_bucket"?: string,"p_detail"?: boolean,"p_from": string,"p_org_id": string,"p_to": string }; Returns: Json
                           },
"fire_alert":
{ Args: { "p_fingerprint": string,"p_kind": string,"p_mention_ids": (string)[],"p_payload": Json,"p_rule_id": string,"p_severity": Database["public"]['Enums']["priority"],"p_summary": string,"p_title": string }; Returns: string
                           },
"get_source_secret":
{ Args: { "p_source_id": string }; Returns: string
                           },
"mention_stats":
{ Args: { "p_from": string,"p_org_id": string,"p_to": string }; Returns: {
              "department_id": string,"hour": string,"interactions": number,"mentions": number,"sentiment": Database["public"]['Enums']["sentiment"]
            }[]
                           },
"org_members":
{ Args: { "p_org_id": string }; Returns: {
              "department_id": string,"department_name": string,"email": string,"invited_at": string,"last_sign_in_at": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
            }[]
                           },
"record_ai_usage":
{ Args: { "p_cache_read_tokens": number,"p_cache_write_tokens": number,"p_cost_usd": number,"p_input_tokens": number,"p_model": string,"p_org_id": string,"p_output_tokens": number,"p_purpose": string }; Returns: undefined
                           },
"refresh_mention_stats":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"route_mentions":
{ Args: { "p_department_id": string,"p_due_at": string,"p_mention_ids": (string)[] }; Returns: number
                           },
"save_query_version":
{ Args: { "p_builder"?: Json,"p_expression": string,"p_lineage_id"?: string,"p_name": string,"p_project_id": string }; Returns: {
              "builder": Json | null,
"created_at": string,
"created_by": string | null,
"expression": string,
"filters": NonNullable<Json>,
"id": string,
"is_active": boolean,
"lineage_id": string,
"name": string,
"org_id": string,
"project_id": string,
"version": number
            }
                          SetofOptions: {
        from: "*"
        to: "queries"
        isOneToOne: true
        isSetofReturn: false
      } },
"set_source_secret":
{ Args: { "p_secret": string,"p_source_id": string }; Returns: undefined
                           },
"source_labels":
{ Args: { "p_org_id": string }; Returns: {
              "id": string,"name": string,"type": Database["public"]['Enums']["source_type"]
            }[]
                           }
          }
          Enums: {
            "author_kind": "media"|"public_figure"|"citizen","membership_role": "admin"|"comunicacion"|"dependencia"|"lectura","mention_status": "pending"|"classified"|"failed","priority": "low"|"medium"|"high"|"critical","report_period": "daily"|"weekly"|"monthly","sentiment": "positive"|"neutral"|"negative","source_type": "meta"|"rss"|"youtube"|"x","ticket_status": "open"|"in_progress"|"resolved"|"closed","triage_status": "new"|"reviewed"|"routed"|"discarded"
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
            "author_kind": ["media", "public_figure", "citizen"],"membership_role": ["admin", "comunicacion", "dependencia", "lectura"],"mention_status": ["pending", "classified", "failed"],"priority": ["low", "medium", "high", "critical"],"report_period": ["daily", "weekly", "monthly"],"sentiment": ["positive", "neutral", "negative"],"source_type": ["meta", "rss", "youtube", "x"],"ticket_status": ["open", "in_progress", "resolved", "closed"],"triage_status": ["new", "reviewed", "routed", "discarded"]
          }
        }
} as const
