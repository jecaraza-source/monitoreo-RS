
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
                },"app_errors": {
                  Row: {
                    "context": NonNullable<Json>,"created_at": string,"digest": string | null,"id": number,"message": string,"org_id": string | null,"path": string | null,"source": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "context"?: NonNullable<Json>,"created_at"?: string,"digest"?: string | null,"id"?: never,"message": string,"org_id"?: string | null,"path"?: string | null,"source": string,"user_id"?: string | null
                  }
                  Update: {
                    "context"?: NonNullable<Json>,"created_at"?: string,"digest"?: string | null,"id"?: never,"message"?: string,"org_id"?: string | null,"path"?: string | null,"source"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "app_errors_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"changes": NonNullable<Json>,"created_at": string,"entity": string,"entity_id": string | null,"id": number,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"changes"?: NonNullable<Json>,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: never,"org_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"changes"?: NonNullable<Json>,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: never,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_org_id_fkey"
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
                },"daily_readings": {
                  Row: {
                    "facts": NonNullable<Json>,"generated_at": string,"model": string | null,"org_id": string,"sentences": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "facts"?: NonNullable<Json>,"generated_at"?: string,"model"?: string | null,"org_id": string,"sentences": (string)[]
                  }
                  Update: {
                    "facts"?: NonNullable<Json>,"generated_at"?: string,"model"?: string | null,"org_id"?: string,"sentences"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "daily_readings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"org_id": string,"responsible_user_id": string | null,"short_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"org_id": string,"responsible_user_id"?: string | null,"short_name"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"responsible_user_id"?: string | null,"short_name"?: string | null
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
                    "complete": boolean | null,"covered_until": string | null,"created_at": string,"duplicates": number,"error": string | null,"fetched": number,"finished_at": string,"gap_from": string | null,"gap_to": string | null,"id": string,"inserted": number,"limits": NonNullable<Json>,"org_id": string,"run_id": string | null,"source_id": string,"started_at": string,"status": string,"trigger": string,"unmatched": number,"updated": number,"window_from": string | null,"window_to": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "complete"?: boolean | null,"covered_until"?: string | null,"created_at"?: string,"duplicates"?: number,"error"?: string | null,"fetched"?: number,"finished_at"?: string,"gap_from"?: string | null,"gap_to"?: string | null,"id"?: string,"inserted"?: number,"limits"?: NonNullable<Json>,"org_id": string,"run_id"?: string | null,"source_id": string,"started_at": string,"status": string,"trigger": string,"unmatched"?: number,"updated"?: number,"window_from"?: string | null,"window_to"?: string | null
                  }
                  Update: {
                    "complete"?: boolean | null,"covered_until"?: string | null,"created_at"?: string,"duplicates"?: number,"error"?: string | null,"fetched"?: number,"finished_at"?: string,"gap_from"?: string | null,"gap_to"?: string | null,"id"?: string,"inserted"?: number,"limits"?: NonNullable<Json>,"org_id"?: string,"run_id"?: string | null,"source_id"?: string,"started_at"?: string,"status"?: string,"trigger"?: string,"unmatched"?: number,"updated"?: number,"window_from"?: string | null,"window_to"?: string | null
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
                    "can_view_officials": boolean,"created_at": string,"department_id": string | null,"id": string,"org_id": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "can_view_officials"?: boolean,"created_at"?: string,"department_id"?: string | null,"id"?: string,"org_id": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
                  }
                  Update: {
                    "can_view_officials"?: boolean,"created_at"?: string,"department_id"?: string | null,"id"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["membership_role"],"user_id"?: string
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
                    "author_id": string,"author_name": string,"body": string,"channel": string,"created_at": string,"id": string,"mention_id": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string,"author_name"?: string,"body": string,"channel"?: string,"created_at"?: string,"id"?: string,"mention_id": string,"org_id": string
                  }
                  Update: {
                    "author_id"?: string,"author_name"?: string,"body"?: string,"channel"?: string,"created_at"?: string,"id"?: string,"mention_id"?: string,"org_id"?: string
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
                    "attempts": number,"author_id": string | null,"claim_expires_at": string | null,"claim_id": string | null,"created_at": string,"external_id": string,"id": string,"last_error": string | null,"metrics": NonNullable<Json>,"metrics_updated_at": string | null,"next_attempt_at": string | null,"org_id": string,"published_at": string,"query_id": string | null,"search": unknown,"source_id": string,"status": Database["public"]['Enums']["mention_status"],"text": string,"triage": Database["public"]['Enums']["triage_status"],"url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"author_id"?: string | null,"claim_expires_at"?: string | null,"claim_id"?: string | null,"created_at"?: string,"external_id": string,"id"?: string,"last_error"?: string | null,"metrics"?: NonNullable<Json>,"metrics_updated_at"?: string | null,"next_attempt_at"?: string | null,"org_id": string,"published_at": string,"query_id"?: string | null,"search"?: never,"source_id": string,"status"?: Database["public"]['Enums']["mention_status"],"text": string,"triage"?: Database["public"]['Enums']["triage_status"],"url"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"author_id"?: string | null,"claim_expires_at"?: string | null,"claim_id"?: string | null,"created_at"?: string,"external_id"?: string,"id"?: string,"last_error"?: string | null,"metrics"?: NonNullable<Json>,"metrics_updated_at"?: string | null,"next_attempt_at"?: string | null,"org_id"?: string,"published_at"?: string,"query_id"?: string | null,"search"?: never,"source_id"?: string,"status"?: Database["public"]['Enums']["mention_status"],"text"?: string,"triage"?: Database["public"]['Enums']["triage_status"],"url"?: string | null
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
                    "created_at": string,"geojson": Json | null,"id": string,"name": string,"org_id": string,"shape_source": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"geojson"?: Json | null,"id"?: string,"name": string,"org_id": string,"shape_source"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"geojson"?: Json | null,"id"?: string,"name"?: string,"org_id"?: string,"shape_source"?: string | null
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
                },"official_mentions": {
                  Row: {
                    "mention_id": string,"official_id": string,"org_id": string,"published_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "mention_id": string,"official_id": string,"org_id": string,"published_at": string
                  }
                  Update: {
                    "mention_id"?: string,"official_id"?: string,"org_id"?: string,"published_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "official_mentions_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "official_mentions_org_id_official_id_fkey"
      columns: ["org_id","official_id"]
isOneToOne: false
      referencedRelation: "officials"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"officials": {
                  Row: {
                    "aliases": (string)[],"created_at": string,"id": string,"is_active": boolean,"name": string,"org_id": string,"position": string
                  }
                  ComputedFields: never
                  Insert: {
                    "aliases"?: (string)[],"created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"org_id": string,"position": string
                  }
                  Update: {
                    "aliases"?: (string)[],"created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"org_id"?: string,"position"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "officials_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "brand_accent": string,"brand_primary": string,"created_at": string,"id": string,"name": string,"slug": string,"state": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_accent"?: string,"brand_primary"?: string,"created_at"?: string,"id"?: string,"name": string,"slug": string,"state"?: string | null
                  }
                  Update: {
                    "brand_accent"?: string,"brand_primary"?: string,"created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"state"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"pipeline_failures": {
                  Row: {
                    "attempts": number,"error": string | null,"first_failed_at": string,"id": string,"kind": string,"last_failed_at": string,"mention_id": string | null,"org_id": string,"resolution": string | null,"resolved_at": string | null,"resolved_by": string | null,"source_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"error"?: string | null,"first_failed_at"?: string,"id"?: string,"kind": string,"last_failed_at"?: string,"mention_id"?: string | null,"org_id": string,"resolution"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"error"?: string | null,"first_failed_at"?: string,"id"?: string,"kind"?: string,"last_failed_at"?: string,"mention_id"?: string | null,"org_id"?: string,"resolution"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null,"source_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "pipeline_failures_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pipeline_failures_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "pipeline_failures_org_id_source_id_fkey"
      columns: ["org_id","source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["org_id","id"]
    }
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
                },"report_schedules": {
                  Row: {
                    "auto_approve": boolean,"created_at": string,"id": string,"is_active": boolean,"last_run_at": string | null,"org_id": string,"period": Database["public"]['Enums']["report_period"],"recipients": (string)[],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auto_approve"?: boolean,"created_at"?: string,"id"?: string,"is_active"?: boolean,"last_run_at"?: string | null,"org_id": string,"period": Database["public"]['Enums']["report_period"],"recipients"?: (string)[],"updated_at"?: string
                  }
                  Update: {
                    "auto_approve"?: boolean,"created_at"?: string,"id"?: string,"is_active"?: boolean,"last_run_at"?: string | null,"org_id"?: string,"period"?: Database["public"]['Enums']["report_period"],"recipients"?: (string)[],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_schedules_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"reports": {
                  Row: {
                    "approved_at": string | null,"approved_by": string | null,"content": NonNullable<Json>,"created_at": string,"created_by": string | null,"delivery": NonNullable<Json>,"facts": NonNullable<Json>,"id": string,"model": string | null,"org_id": string,"pdf_path": string | null,"period": Database["public"]['Enums']["report_period"],"period_end": string,"period_start": string,"recipients": (string)[],"schedule_id": string | null,"sent_at": string | null,"status": Database["public"]['Enums']["report_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"delivery"?: NonNullable<Json>,"facts"?: NonNullable<Json>,"id"?: string,"model"?: string | null,"org_id": string,"pdf_path"?: string | null,"period": Database["public"]['Enums']["report_period"],"period_end": string,"period_start": string,"recipients"?: (string)[],"schedule_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"title"?: string,"updated_at"?: string
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"delivery"?: NonNullable<Json>,"facts"?: NonNullable<Json>,"id"?: string,"model"?: string | null,"org_id"?: string,"pdf_path"?: string | null,"period"?: Database["public"]['Enums']["report_period"],"period_end"?: string,"period_start"?: string,"recipients"?: (string)[],"schedule_id"?: string | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_schedule_fk"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "report_schedules"
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
                },"sla_policies": {
                  Row: {
                    "hours": number,"org_id": string,"priority": Database["public"]['Enums']["priority"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hours": number,"org_id": string,"priority": Database["public"]['Enums']["priority"],"updated_at"?: string
                  }
                  Update: {
                    "hours"?: number,"org_id"?: string,"priority"?: Database["public"]['Enums']["priority"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sla_policies_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"sources": {
                  Row: {
                    "config": NonNullable<Json>,"consecutive_failures": number,"covered_until": string | null,"created_at": string,"cursor": NonNullable<Json>,"has_secret": boolean,"id": string,"is_active": boolean,"last_error": string | null,"last_error_at": string | null,"last_run_at": string | null,"last_success_at": string | null,"name": string,"org_id": string,"run_lease_id": string | null,"run_lease_until": string | null,"type": Database["public"]['Enums']["source_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"consecutive_failures"?: number,"covered_until"?: string | null,"created_at"?: string,"cursor"?: NonNullable<Json>,"has_secret"?: boolean,"id"?: string,"is_active"?: boolean,"last_error"?: string | null,"last_error_at"?: string | null,"last_run_at"?: string | null,"last_success_at"?: string | null,"name": string,"org_id": string,"run_lease_id"?: string | null,"run_lease_until"?: string | null,"type": Database["public"]['Enums']["source_type"]
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"consecutive_failures"?: number,"covered_until"?: string | null,"created_at"?: string,"cursor"?: NonNullable<Json>,"has_secret"?: boolean,"id"?: string,"is_active"?: boolean,"last_error"?: string | null,"last_error_at"?: string | null,"last_run_at"?: string | null,"last_success_at"?: string | null,"name"?: string,"org_id"?: string,"run_lease_id"?: string | null,"run_lease_until"?: string | null,"type"?: Database["public"]['Enums']["source_type"]
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
                    "assigned_at": string,"assignee_id": string | null,"created_at": string,"created_by": string | null,"department_id": string,"due_at": string | null,"id": string,"is_primary": boolean,"mention_id": string,"org_id": string,"resolved_at": string | null,"status": Database["public"]['Enums']["ticket_status"],"whatsapp_escalated_at": string | null,"whatsapp_notified_at": string | null,"whatsapp_reminded_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"assignee_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"department_id": string,"due_at"?: string | null,"id"?: string,"is_primary"?: boolean,"mention_id": string,"org_id": string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"],"whatsapp_escalated_at"?: string | null,"whatsapp_notified_at"?: string | null,"whatsapp_reminded_at"?: string | null
                  }
                  Update: {
                    "assigned_at"?: string,"assignee_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"department_id"?: string,"due_at"?: string | null,"id"?: string,"is_primary"?: boolean,"mention_id"?: string,"org_id"?: string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"],"whatsapp_escalated_at"?: string | null,"whatsapp_notified_at"?: string | null,"whatsapp_reminded_at"?: string | null
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
                },"whatsapp_contacts": {
                  Row: {
                    "confirmed_at": string | null,"created_at": string,"id": string,"invited_at": string | null,"last_inbound_at": string | null,"opted_out_at": string | null,"org_id": string,"phone": string,"status": Database["public"]['Enums']["whatsapp_contact_status"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_at"?: string | null,"created_at"?: string,"id"?: string,"invited_at"?: string | null,"last_inbound_at"?: string | null,"opted_out_at"?: string | null,"org_id": string,"phone": string,"status"?: Database["public"]['Enums']["whatsapp_contact_status"],"user_id": string
                  }
                  Update: {
                    "confirmed_at"?: string | null,"created_at"?: string,"id"?: string,"invited_at"?: string | null,"last_inbound_at"?: string | null,"opted_out_at"?: string | null,"org_id"?: string,"phone"?: string,"status"?: Database["public"]['Enums']["whatsapp_contact_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_contacts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "whatsapp_contacts_org_id_user_id_fkey"
      columns: ["org_id","user_id"]
isOneToOne: true
      referencedRelation: "memberships"
      referencedColumns: ["org_id","user_id"]
    }
                  ]
                },"whatsapp_messages": {
                  Row: {
                    "body": string | null,"contact_id": string | null,"created_at": string,"direction": string,"error": string | null,"id": string,"kind": string,"org_id": string | null,"status": string,"status_at": string,"template": string | null,"ticket_id": string | null,"wa_message_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"contact_id"?: string | null,"created_at"?: string,"direction": string,"error"?: string | null,"id"?: string,"kind": string,"org_id"?: string | null,"status": string,"status_at"?: string,"template"?: string | null,"ticket_id"?: string | null,"wa_message_id"?: string | null
                  }
                  Update: {
                    "body"?: string | null,"contact_id"?: string | null,"created_at"?: string,"direction"?: string,"error"?: string | null,"id"?: string,"kind"?: string,"org_id"?: string | null,"status"?: string,"status_at"?: string,"template"?: string | null,"ticket_id"?: string | null,"wa_message_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_messages_contact_id_fkey"
      columns: ["contact_id"]
isOneToOne: false
      referencedRelation: "whatsapp_contacts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "whatsapp_messages_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "whatsapp_messages_ticket_id_fkey"
      columns: ["ticket_id"]
isOneToOne: false
      referencedRelation: "tickets"
      referencedColumns: ["id"]
    }
                  ]
                },"whatsapp_settings": {
                  Row: {
                    "escalation_user_id": string | null,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "escalation_user_id"?: string | null,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "escalation_user_id"?: string | null,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "whatsapp_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"worker_runs": {
                  Row: {
                    "counters": NonNullable<Json>,"finished_at": string,"id": string,"kind": string,"org_id": string,"run_id": string,"started_at": string,"status": string,"stopped_by": string | null,"trigger": string
                  }
                  ComputedFields: never
                  Insert: {
                    "counters"?: NonNullable<Json>,"finished_at"?: string,"id"?: string,"kind": string,"org_id": string,"run_id": string,"started_at": string,"status": string,"stopped_by"?: string | null,"trigger": string
                  }
                  Update: {
                    "counters"?: NonNullable<Json>,"finished_at"?: string,"id"?: string,"kind"?: string,"org_id"?: string,"run_id"?: string,"started_at"?: string,"status"?: string,"stopped_by"?: string | null,"trigger"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "worker_runs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
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
"can_view_officials":
{ Args: { "p_org_id": string }; Returns: boolean
                           },
"claim_mentions":
{ Args: { "p_claim_id": string,"p_lease_seconds": number,"p_limit": number,"p_max_attempts": number }; Returns: {
              "attempts": number,"author_kind": Database["public"]['Enums']["author_kind"],"author_name": string,"id": string,"org_id": string,"project_id": string,"published_at": string,"source_name": string,"source_type": Database["public"]['Enums']["source_type"],"text": string
            }[]
                           },
"claim_sources":
{ Args: { "p_lease_id": string,"p_lease_seconds": number,"p_limit": number,"p_org_id"?: string,"p_respect_backoff"?: boolean,"p_source_ids"?: (string)[],"p_types": (Database["public"]['Enums']["source_type"])[] }; Returns: {
              "config": NonNullable<Json>,
"consecutive_failures": number,
"covered_until": string | null,
"created_at": string,
"cursor": NonNullable<Json>,
"has_secret": boolean,
"id": string,
"is_active": boolean,
"last_error": string | null,
"last_error_at": string | null,
"last_run_at": string | null,
"last_success_at": string | null,
"name": string,
"org_id": string,
"run_lease_id": string | null,
"run_lease_until": string | null,
"type": Database["public"]['Enums']["source_type"]
            }[]
                          SetofOptions: {
        from: "*"
        to: "sources"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_whatsapp_followups":
{ Args: { "p_limit": number,"p_now": string }; Returns: {
              "kind": string,"ticket_id": string
            }[]
                           },
"clear_source_secret":
{ Args: { "p_source_id": string }; Returns: undefined
                           },
"complete_classifications":
{ Args: { "p_claim_id": string,"p_failures": Json,"p_max_attempts": number,"p_results": Json }; Returns: Json
                           },
"crisis_snapshot":
{ Args: { "p_minutes"?: number,"p_org_id": string }; Returns: Json
                           },
"dashboard_stats":
{ Args: { "p_bucket"?: string,"p_detail"?: boolean,"p_from": string,"p_org_id": string,"p_to": string }; Returns: Json
                           },
"finish_source_run":
{ Args: { "p_lease_id": string,"p_run": Json,"p_source_id": string,"p_state": Json }; Returns: boolean
                           },
"fire_alert":
{ Args: { "p_fingerprint": string,"p_kind": string,"p_mention_ids": (string)[],"p_payload": Json,"p_rule_id": string,"p_severity": Database["public"]['Enums']["priority"],"p_summary": string,"p_title": string }; Returns: string
                           },
"get_source_secret":
{ Args: { "p_source_id": string }; Returns: string
                           },
"ingest_mentions":
{ Args: { "p_org_id": string,"p_rows": Json,"p_source_id": string }; Returns: Json
                           },
"invite_whatsapp_contact":
{ Args: { "p_org_id": string,"p_phone": string,"p_user_id": string }; Returns: string
                           },
"log_event":
{ Args: { "p_action": string,"p_details"?: Json,"p_entity": string,"p_entity_id": string,"p_org_id": string }; Returns: undefined
                           },
"map_stats":
{ Args: { "p_department"?: string,"p_from": string,"p_org_id": string,"p_prev_from": string,"p_sentiment"?: Database["public"]['Enums']["sentiment"],"p_to": string,"p_topic"?: string }; Returns: Json
                           },
"mention_stats":
{ Args: { "p_from": string,"p_org_id": string,"p_to": string }; Returns: {
              "department_id": string,"hour": string,"interactions": number,"mentions": number,"sentiment": Database["public"]['Enums']["sentiment"]
            }[]
                           },
"neighborhood_detail":
{ Args: { "p_from": string,"p_neighborhood_id": string,"p_org_id": string,"p_to": string }; Returns: Json
                           },
"official_mentions_list":
{ Args: { "p_from": string,"p_limit"?: number,"p_official_id": string,"p_org_id": string,"p_sentiment"?: Database["public"]['Enums']["sentiment"],"p_to": string }; Returns: {
              "author": string,"emotion": string,"interactions": number,"mention_id": string,"published_at": string,"sentiment": Database["public"]['Enums']["sentiment"],"source": string,"text": string,"topic": string,"url": string
            }[]
                           },
"officials_stats":
{ Args: { "p_from": string,"p_org_id": string,"p_prev_from": string,"p_to": string }; Returns: Json
                           },
"org_members":
{ Args: { "p_org_id": string }; Returns: {
              "department_id": string,"department_name": string,"email": string,"invited_at": string,"last_sign_in_at": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
            }[]
                           },
"purge_old_mentions":
{ Args: { "p_batch"?: number,"p_months": number }; Returns: number
                           },
"purge_old_whatsapp_messages":
{ Args: { "p_months": number }; Returns: number
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"remaining": number,"reset_at": string
            }[]
                           },
"record_ai_usage":
{ Args: { "p_cache_read_tokens": number,"p_cache_write_tokens": number,"p_cost_usd": number,"p_input_tokens": number,"p_model": string,"p_org_id": string,"p_output_tokens": number,"p_purpose": string }; Returns: undefined
                           },
"refresh_mention_stats":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"release_mentions":
{ Args: { "p_claim_id": string,"p_count_attempt"?: boolean,"p_error"?: string,"p_ids": (string)[] }; Returns: number
                           },
"remove_whatsapp_contact":
{ Args: { "p_org_id": string,"p_user_id": string }; Returns: undefined
                           },
"report_extras":
{ Args: { "p_bucket"?: string,"p_from": string,"p_org_id": string,"p_peaks"?: (string)[],"p_to": string }; Returns: Json
                           },
"resolve_pipeline_failure":
{ Args: { "p_action": string,"p_failure_id": string }; Returns: undefined
                           },
"route_mentions":
{ Args: { "p_department_id": string,"p_due_at": string,"p_mention_ids": (string)[],"p_support_ids"?: (string)[] }; Returns: number
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
"set_report_recipients":
{ Args: { "p_recipients": (string)[],"p_report_id": string }; Returns: (string)[]
                           },
"set_source_secret":
{ Args: { "p_secret": string,"p_source_id": string }; Returns: undefined
                           },
"source_labels":
{ Args: { "p_org_id": string }; Returns: {
              "id": string,"name": string,"type": Database["public"]['Enums']["source_type"]
            }[]
                           },
"whatsapp_recipients":
{ Args: { "p_org_id": string }; Returns: {
              "email": string,"status": Database["public"]['Enums']["whatsapp_contact_status"],"user_id": string
            }[]
                           },
"whatsapp_ticket_action":
{ Args: { "p_contact_id": string,"p_note"?: string,"p_status"?: Database["public"]['Enums']["ticket_status"],"p_ticket_id": string }; Returns: Json
                           }
          }
          Enums: {
            "author_kind": "media"|"public_figure"|"citizen","membership_role": "admin"|"comunicacion"|"dependencia"|"lectura","mention_status": "pending"|"classified"|"failed","priority": "low"|"medium"|"high"|"critical","report_period": "daily"|"weekly"|"monthly","report_status": "draft"|"approved"|"sent","sentiment": "positive"|"neutral"|"negative","source_type": "meta"|"rss"|"youtube"|"x","ticket_status": "open"|"in_progress"|"resolved"|"closed","triage_status": "new"|"reviewed"|"routed"|"discarded","whatsapp_contact_status": "pending"|"active"|"declined"|"opted_out"
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
            "author_kind": ["media", "public_figure", "citizen"],"membership_role": ["admin", "comunicacion", "dependencia", "lectura"],"mention_status": ["pending", "classified", "failed"],"priority": ["low", "medium", "high", "critical"],"report_period": ["daily", "weekly", "monthly"],"report_status": ["draft", "approved", "sent"],"sentiment": ["positive", "neutral", "negative"],"source_type": ["meta", "rss", "youtube", "x"],"ticket_status": ["open", "in_progress", "resolved", "closed"],"triage_status": ["new", "reviewed", "routed", "discarded"],"whatsapp_contact_status": ["pending", "active", "declined", "opted_out"]
          }
        }
} as const
