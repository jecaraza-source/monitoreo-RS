
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "ai_calls": {
                  Row: {
                    "cache_read_tokens": number | null,"cache_write_tokens": number | null,"cost_status": string | null,"cost_usd": number | null,"created_at": string,"error": string | null,"expires_at": string,"id": string,"input_tokens": number | null,"model": string,"org_id": string,"output_tokens": number | null,"purpose": string,"reserved_tokens": number,"reserved_usd": number | null,"settled_at": string | null,"status": string,"tariff_version": string | null,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cache_read_tokens"?: number | null,"cache_write_tokens"?: number | null,"cost_status"?: string | null,"cost_usd"?: number | null,"created_at"?: string,"error"?: string | null,"expires_at": string,"id"?: string,"input_tokens"?: number | null,"model": string,"org_id": string,"output_tokens"?: number | null,"purpose": string,"reserved_tokens": number,"reserved_usd"?: number | null,"settled_at"?: string | null,"status"?: string,"tariff_version"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "cache_read_tokens"?: number | null,"cache_write_tokens"?: number | null,"cost_status"?: string | null,"cost_usd"?: number | null,"created_at"?: string,"error"?: string | null,"expires_at"?: string,"id"?: string,"input_tokens"?: number | null,"model"?: string,"org_id"?: string,"output_tokens"?: number | null,"purpose"?: string,"reserved_tokens"?: number,"reserved_usd"?: number | null,"settled_at"?: string | null,"status"?: string,"tariff_version"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_calls_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_invoices": {
                  Row: {
                    "amount_usd": number,"id": string,"month": string,"notes": string | null,"org_id": string,"recorded_at": string,"recorded_by": string,"reference": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_usd": number,"id"?: string,"month": string,"notes"?: string | null,"org_id": string,"recorded_at"?: string,"recorded_by": string,"reference"?: string | null
                  }
                  Update: {
                    "amount_usd"?: number,"id"?: string,"month"?: string,"notes"?: string | null,"org_id"?: string,"recorded_at"?: string,"recorded_by"?: string,"reference"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_invoices_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_leases": {
                  Row: {
                    "expires_at": string,"holder": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "expires_at": string,"holder": string,"name": string,"org_id": string
                  }
                  Update: {
                    "expires_at"?: string,"holder"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_leases_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_limits": {
                  Row: {
                    "daily_budget_usd": number | null,"daily_token_budget": number | null,"max_concurrent": NonNullable<Json>,"monthly_budget_usd": number | null,"org_id": string,"updated_at": string,"updated_by": string | null,"user_daily_requests": number
                  }
                  ComputedFields: never
                  Insert: {
                    "daily_budget_usd"?: number | null,"daily_token_budget"?: number | null,"max_concurrent"?: NonNullable<Json>,"monthly_budget_usd"?: number | null,"org_id": string,"updated_at"?: string,"updated_by"?: string | null,"user_daily_requests"?: number
                  }
                  Update: {
                    "daily_budget_usd"?: number | null,"daily_token_budget"?: number | null,"max_concurrent"?: NonNullable<Json>,"monthly_budget_usd"?: number | null,"org_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"user_daily_requests"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_limits_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "cache_read_tokens": number,"cache_write_tokens": number,"cost_usd": number,"created_at": string,"day": string,"id": string,"input_tokens": number,"model": string,"org_id": string,"output_tokens": number,"purpose": string,"requests": number,"tariff_version": string | null,"unpriced_requests": number,"unpriced_tokens": number
                  }
                  ComputedFields: never
                  Insert: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"day": string,"id"?: string,"input_tokens"?: number,"model": string,"org_id": string,"output_tokens"?: number,"purpose": string,"requests"?: number,"tariff_version"?: string | null,"unpriced_requests"?: number,"unpriced_tokens"?: number
                  }
                  Update: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"day"?: string,"id"?: string,"input_tokens"?: number,"model"?: string,"org_id"?: string,"output_tokens"?: number,"purpose"?: string,"requests"?: number,"tariff_version"?: string | null,"unpriced_requests"?: number,"unpriced_tokens"?: number
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
                },"author_events": {
                  Row: {
                    "action": string,"actor_id": string | null,"actor_name": string | null,"author_id": string | null,"created_at": string,"from_kind": Database["public"]['Enums']["author_kind"] | null,"id": number,"org_id": string,"reason": string,"to_kind": Database["public"]['Enums']["author_kind"] | null,"verified_author_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"actor_name"?: string | null,"author_id"?: string | null,"created_at"?: string,"from_kind"?: Database["public"]['Enums']["author_kind"] | null,"id"?: never,"org_id": string,"reason": string,"to_kind"?: Database["public"]['Enums']["author_kind"] | null,"verified_author_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"actor_name"?: string | null,"author_id"?: string | null,"created_at"?: string,"from_kind"?: Database["public"]['Enums']["author_kind"] | null,"id"?: never,"org_id"?: string,"reason"?: string,"to_kind"?: Database["public"]['Enums']["author_kind"] | null,"verified_author_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "author_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"authors": {
                  Row: {
                    "created_at": string,"display_name": string | null,"followers": number | null,"handle": string,"id": string,"kind": Database["public"]['Enums']["author_kind"],"org_id": string,"platform": Database["public"]['Enums']["source_type"],"pseudonymized_at": string | null,"verification": string,"verified_author_id": string | null,"vouching_source_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"followers"?: number | null,"handle": string,"id"?: string,"kind"?: Database["public"]['Enums']["author_kind"],"org_id": string,"platform": Database["public"]['Enums']["source_type"],"pseudonymized_at"?: string | null,"verification"?: string,"verified_author_id"?: string | null,"vouching_source_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"followers"?: number | null,"handle"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["author_kind"],"org_id"?: string,"platform"?: Database["public"]['Enums']["source_type"],"pseudonymized_at"?: string | null,"verification"?: string,"verified_author_id"?: string | null,"vouching_source_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "authors_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "authors_verified_author_fk"
      columns: ["org_id","verified_author_id"]
isOneToOne: false
      referencedRelation: "verified_authors"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "authors_vouching_source_fk"
      columns: ["org_id","vouching_source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"case_categories": {
                  Row: {
                    "active": boolean,"created_at": string,"default_department_id": string | null,"description": string,"id": string,"name": string,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"default_department_id"?: string | null,"description"?: string,"id"?: string,"name": string,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"default_department_id"?: string | null,"description"?: string,"id"?: string,"name"?: string,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_categories_org_id_default_department_id_fkey"
      columns: ["org_id","default_department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_categories_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_counters": {
                  Row: {
                    "last_number": number,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "last_number"?: number,"org_id": string
                  }
                  Update: {
                    "last_number"?: number,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_counters_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_events": {
                  Row: {
                    "actor_id": string | null,"actor_kind": string,"actor_name": string,"at": string,"case_id": string,"changes": NonNullable<Json>,"from_status": Database["public"]['Enums']["case_status"] | null,"id": number,"internal": boolean,"operation": string,"org_id": string,"reason": string | null,"to_status": Database["public"]['Enums']["case_status"] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_kind": string,"actor_name"?: string,"at"?: string,"case_id": string,"changes"?: NonNullable<Json>,"from_status"?: Database["public"]['Enums']["case_status"] | null,"id"?: never,"internal"?: boolean,"operation": string,"org_id": string,"reason"?: string | null,"to_status"?: Database["public"]['Enums']["case_status"] | null
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_kind"?: string,"actor_name"?: string,"at"?: string,"case_id"?: string,"changes"?: NonNullable<Json>,"from_status"?: Database["public"]['Enums']["case_status"] | null,"id"?: never,"internal"?: boolean,"operation"?: string,"org_id"?: string,"reason"?: string | null,"to_status"?: Database["public"]['Enums']["case_status"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_events_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_evidence": {
                  Row: {
                    "audience": string,"case_id": string,"created_at": string,"cycle": number,"department_id": string | null,"id": string,"mime": string,"org_id": string,"path": string,"size_bytes": number,"update_id": string,"uploaded_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "audience": string,"case_id": string,"created_at"?: string,"cycle": number,"department_id"?: string | null,"id"?: string,"mime": string,"org_id": string,"path": string,"size_bytes": number,"update_id": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "audience"?: string,"case_id"?: string,"created_at"?: string,"cycle"?: number,"department_id"?: string | null,"id"?: string,"mime"?: string,"org_id"?: string,"path"?: string,"size_bytes"?: number,"update_id"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_evidence_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_evidence_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_evidence_update_id_fkey"
      columns: ["update_id"]
isOneToOne: false
      referencedRelation: "case_updates"
      referencedColumns: ["id"]
    }
                  ]
                },"case_location_events": {
                  Row: {
                    "actor_id": string | null,"actor_name": string,"at": string,"case_id": string,"confidence": number | null,"id": number,"lat": number | null,"lng": number | null,"neighborhood_id": string | null,"org_id": string,"previous": Json | null,"reason": string | null,"source": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_name"?: string,"at"?: string,"case_id": string,"confidence"?: number | null,"id"?: never,"lat"?: number | null,"lng"?: number | null,"neighborhood_id"?: string | null,"org_id": string,"previous"?: Json | null,"reason"?: string | null,"source"?: string | null,"status": string
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_name"?: string,"at"?: string,"case_id"?: string,"confidence"?: number | null,"id"?: never,"lat"?: number | null,"lng"?: number | null,"neighborhood_id"?: string | null,"org_id"?: string,"previous"?: Json | null,"reason"?: string | null,"source"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_location_events_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_location_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_mentions": {
                  Row: {
                    "added_at": string,"added_by": string | null,"case_id": string,"mention_id": string,"org_id": string,"reason": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "added_at"?: string,"added_by"?: string | null,"case_id": string,"mention_id": string,"org_id": string,"reason"?: string | null
                  }
                  Update: {
                    "added_at"?: string,"added_by"?: string | null,"case_id"?: string,"mention_id"?: string,"org_id"?: string,"reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_mentions_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_mentions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_mentions_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"case_milestones": {
                  Row: {
                    "actor_id": string | null,"at": string,"case_id": string,"cycle": number,"department_id": string | null,"from_status": Database["public"]['Enums']["case_status"] | null,"id": number,"org_id": string,"source": string,"status": Database["public"]['Enums']["case_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"at"?: string,"case_id": string,"cycle": number,"department_id"?: string | null,"from_status"?: Database["public"]['Enums']["case_status"] | null,"id"?: never,"org_id": string,"source"?: string,"status": Database["public"]['Enums']["case_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"at"?: string,"case_id"?: string,"cycle"?: number,"department_id"?: string | null,"from_status"?: Database["public"]['Enums']["case_status"] | null,"id"?: never,"org_id"?: string,"source"?: string,"status"?: Database["public"]['Enums']["case_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_milestones_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_milestones_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_notes": {
                  Row: {
                    "author_id": string | null,"author_name": string,"body": string,"case_id": string,"created_at": string,"id": string,"org_id": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"author_name"?: string,"body": string,"case_id": string,"created_at"?: string,"id"?: string,"org_id": string,"visibility": string
                  }
                  Update: {
                    "author_id"?: string | null,"author_name"?: string,"body"?: string,"case_id"?: string,"created_at"?: string,"id"?: string,"org_id"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_notes_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_notes_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_tasks": {
                  Row: {
                    "case_id": string,"created_at": string,"created_by": string | null,"cycle": number,"department_id": string,"detail": string,"done_at": string | null,"due_at": string | null,"id": string,"org_id": string,"responsible_user_id": string | null,"status": Database["public"]['Enums']["case_task_status"],"status_note": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id": string,"created_at"?: string,"created_by"?: string | null,"cycle": number,"department_id": string,"detail"?: string,"done_at"?: string | null,"due_at"?: string | null,"id"?: string,"org_id": string,"responsible_user_id"?: string | null,"status"?: Database["public"]['Enums']["case_task_status"],"status_note"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "case_id"?: string,"created_at"?: string,"created_by"?: string | null,"cycle"?: number,"department_id"?: string,"detail"?: string,"done_at"?: string | null,"due_at"?: string | null,"id"?: string,"org_id"?: string,"responsible_user_id"?: string | null,"status"?: Database["public"]['Enums']["case_task_status"],"status_note"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_tasks_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_tasks_org_id_department_id_fkey"
      columns: ["org_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_tasks_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"case_updates": {
                  Row: {
                    "audience": string,"author_id": string | null,"author_name": string,"body": string,"case_id": string,"created_at": string,"cycle": number,"department_id": string | null,"id": string,"kind": string,"org_id": string,"task_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "audience": string,"author_id"?: string | null,"author_name"?: string,"body": string,"case_id": string,"created_at"?: string,"cycle": number,"department_id"?: string | null,"id"?: string,"kind"?: string,"org_id": string,"task_id"?: string | null
                  }
                  Update: {
                    "audience"?: string,"author_id"?: string | null,"author_name"?: string,"body"?: string,"case_id"?: string,"created_at"?: string,"cycle"?: number,"department_id"?: string | null,"id"?: string,"kind"?: string,"org_id"?: string,"task_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_updates_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_updates_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "case_updates_task_id_fkey"
      columns: ["task_id"]
isOneToOne: false
      referencedRelation: "case_tasks"
      referencedColumns: ["id"]
    }
                  ]
                },"case_validations": {
                  Row: {
                    "at": string,"case_id": string,"cycle": number,"decision": string,"evidence_count": number,"evidence_sufficient": boolean,"id": string,"note": string,"org_id": string,"updates_count": number,"validator_id": string | null,"validator_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"case_id": string,"cycle": number,"decision": string,"evidence_count": number,"evidence_sufficient": boolean,"id"?: string,"note": string,"org_id": string,"updates_count": number,"validator_id"?: string | null,"validator_name"?: string
                  }
                  Update: {
                    "at"?: string,"case_id"?: string,"cycle"?: number,"decision"?: string,"evidence_count"?: number,"evidence_sufficient"?: boolean,"id"?: string,"note"?: string,"org_id"?: string,"updates_count"?: number,"validator_id"?: string | null,"validator_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "case_validations_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_validations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"cases": {
                  Row: {
                    "accept_due_at": string | null,"accepted_at": string | null,"assigned_at": string | null,"backfill_key": string | null,"category": string | null,"closed_at": string | null,"commitment": string | null,"coordinator_user_id": string | null,"cycle": number,"department_id": string | null,"description": string,"due_at": string | null,"folio": string | null,"id": string,"location_confidence": number | null,"location_lat": number | null,"location_lng": number | null,"location_source": string | null,"location_status": string,"location_updated_at": string | null,"location_updated_by": string | null,"merged_into_id": string | null,"neighborhood_id": string | null,"number": number,"opened_at": string,"opened_by": string | null,"org_id": string,"primary_mention_id": string | null,"priority": Database["public"]['Enums']["priority"],"resolved_at": string | null,"responsible_user_id": string | null,"result": string | null,"sla_terms": Json | null,"sla_version_id": string | null,"status": Database["public"]['Enums']["case_status"],"status_reason": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accept_due_at"?: string | null,"accepted_at"?: string | null,"assigned_at"?: string | null,"backfill_key"?: string | null,"category"?: string | null,"closed_at"?: string | null,"commitment"?: string | null,"coordinator_user_id"?: string | null,"cycle"?: number,"department_id"?: string | null,"description"?: string,"due_at"?: string | null,"folio"?: never,"id"?: string,"location_confidence"?: number | null,"location_lat"?: number | null,"location_lng"?: number | null,"location_source"?: string | null,"location_status"?: string,"location_updated_at"?: string | null,"location_updated_by"?: string | null,"merged_into_id"?: string | null,"neighborhood_id"?: string | null,"number": number,"opened_at"?: string,"opened_by"?: string | null,"org_id": string,"primary_mention_id"?: string | null,"priority"?: Database["public"]['Enums']["priority"],"resolved_at"?: string | null,"responsible_user_id"?: string | null,"result"?: string | null,"sla_terms"?: Json | null,"sla_version_id"?: string | null,"status"?: Database["public"]['Enums']["case_status"],"status_reason"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "accept_due_at"?: string | null,"accepted_at"?: string | null,"assigned_at"?: string | null,"backfill_key"?: string | null,"category"?: string | null,"closed_at"?: string | null,"commitment"?: string | null,"coordinator_user_id"?: string | null,"cycle"?: number,"department_id"?: string | null,"description"?: string,"due_at"?: string | null,"folio"?: never,"id"?: string,"location_confidence"?: number | null,"location_lat"?: number | null,"location_lng"?: number | null,"location_source"?: string | null,"location_status"?: string,"location_updated_at"?: string | null,"location_updated_by"?: string | null,"merged_into_id"?: string | null,"neighborhood_id"?: string | null,"number"?: number,"opened_at"?: string,"opened_by"?: string | null,"org_id"?: string,"primary_mention_id"?: string | null,"priority"?: Database["public"]['Enums']["priority"],"resolved_at"?: string | null,"responsible_user_id"?: string | null,"result"?: string | null,"sla_terms"?: Json | null,"sla_version_id"?: string | null,"status"?: Database["public"]['Enums']["case_status"],"status_reason"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cases_org_id_department_id_fkey"
      columns: ["org_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "cases_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cases_org_id_merged_into_id_fkey"
      columns: ["org_id","merged_into_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "cases_org_id_neighborhood_id_fkey"
      columns: ["org_id","neighborhood_id"]
isOneToOne: false
      referencedRelation: "neighborhoods"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "cases_org_id_primary_mention_id_fkey"
      columns: ["org_id","primary_mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "cases_sla_version_fk"
      columns: ["org_id","sla_version_id"]
isOneToOne: false
      referencedRelation: "sla_versions"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"ci_checks": {
                  Row: {
                    "checked_at": string,"checked_by": string,"details": NonNullable<Json>,"id": string,"org_id": string,"provider": string,"report_id": string | null,"status": string,"subject": string,"summary": string
                  }
                  ComputedFields: never
                  Insert: {
                    "checked_at"?: string,"checked_by"?: string,"details"?: NonNullable<Json>,"id"?: string,"org_id": string,"provider": string,"report_id"?: string | null,"status": string,"subject": string,"summary"?: string
                  }
                  Update: {
                    "checked_at"?: string,"checked_by"?: string,"details"?: NonNullable<Json>,"id"?: string,"org_id"?: string,"provider"?: string,"report_id"?: string | null,"status"?: string,"subject"?: string,"summary"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ci_checks_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ci_checks_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "ci_reports"
      referencedColumns: ["id"]
    }
                  ]
                },"ci_reports": {
                  Row: {
                    "closed_at": string | null,"closed_note": string | null,"created_at": string,"created_by": string,"id": string,"indicators": (string)[],"kind": string,"mention_ids": (string)[],"org_id": string,"severity": Database["public"]['Enums']["priority"],"status": string,"summary": string,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"closed_note"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string,"indicators"?: (string)[],"kind": string,"mention_ids"?: (string)[],"org_id": string,"severity"?: Database["public"]['Enums']["priority"],"status"?: string,"summary"?: string,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "closed_at"?: string | null,"closed_note"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string,"indicators"?: (string)[],"kind"?: string,"mention_ids"?: (string)[],"org_id"?: string,"severity"?: Database["public"]['Enums']["priority"],"status"?: string,"summary"?: string,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ci_reports_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ci_settings": {
                  Row: {
                    "official_domains": (string)[],"org_id": string,"updated_at": string,"updated_by": string | null,"watch_terms": (string)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "official_domains"?: (string)[],"org_id": string,"updated_at"?: string,"updated_by"?: string | null,"watch_terms"?: (string)[]
                  }
                  Update: {
                    "official_domains"?: (string)[],"org_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"watch_terms"?: (string)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "ci_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"classification_reviews": {
                  Row: {
                    "ai_output": NonNullable<Json>,"changes": NonNullable<Json>,"created_at": string,"decided_at": string | null,"decided_by": string | null,"decision_reason": string | null,"id": string,"mention_id": string,"org_id": string,"reasons": (string)[],"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_output": NonNullable<Json>,"changes"?: NonNullable<Json>,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_reason"?: string | null,"id"?: string,"mention_id": string,"org_id": string,"reasons": (string)[],"status"?: string
                  }
                  Update: {
                    "ai_output"?: NonNullable<Json>,"changes"?: NonNullable<Json>,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"decision_reason"?: string | null,"id"?: string,"mention_id"?: string,"org_id"?: string,"reasons"?: (string)[],"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "classification_reviews_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "classification_reviews_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"classification_versions": {
                  Row: {
                    "id": number,"mention_id": string,"org_id": string,"reason": string | null,"replaced_at": string,"replaced_by": string | null,"snapshot": NonNullable<Json>,"source": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: never,"mention_id": string,"org_id": string,"reason"?: string | null,"replaced_at"?: string,"replaced_by"?: string | null,"snapshot": NonNullable<Json>,"source": string,"version": number
                  }
                  Update: {
                    "id"?: never,"mention_id"?: string,"org_id"?: string,"reason"?: string | null,"replaced_at"?: string,"replaced_by"?: string | null,"snapshot"?: NonNullable<Json>,"source"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "classification_versions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "classification_versions_org_id_mention_id_fkey"
      columns: ["org_id","mention_id"]
isOneToOne: false
      referencedRelation: "mentions"
      referencedColumns: ["org_id","id"]
    }
                  ]
                },"classifications": {
                  Row: {
                    "confidence": number | null,"confirmed_at": string | null,"confirmed_by": string | null,"corrected_at": string | null,"corrected_by": string | null,"created_at": string,"department_id": string | null,"emotion": string | null,"id": string,"incident_type": string | null,"intent": string | null,"mention_id": string,"model": string,"needs_attention": boolean | null,"neighborhood_id": string | null,"org_id": string,"priority": Database["public"]['Enums']["priority"],"sentiment": Database["public"]['Enums']["sentiment"],"severity": Database["public"]['Enums']["severity"] | null,"topic": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "confidence"?: number | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"corrected_at"?: string | null,"corrected_by"?: string | null,"created_at"?: string,"department_id"?: string | null,"emotion"?: string | null,"id"?: string,"incident_type"?: string | null,"intent"?: string | null,"mention_id": string,"model": string,"needs_attention"?: boolean | null,"neighborhood_id"?: string | null,"org_id": string,"priority"?: Database["public"]['Enums']["priority"],"sentiment": Database["public"]['Enums']["sentiment"],"severity"?: Database["public"]['Enums']["severity"] | null,"topic"?: string | null
                  }
                  Update: {
                    "confidence"?: number | null,"confirmed_at"?: string | null,"confirmed_by"?: string | null,"corrected_at"?: string | null,"corrected_by"?: string | null,"created_at"?: string,"department_id"?: string | null,"emotion"?: string | null,"id"?: string,"incident_type"?: string | null,"intent"?: string | null,"mention_id"?: string,"model"?: string,"needs_attention"?: boolean | null,"neighborhood_id"?: string | null,"org_id"?: string,"priority"?: Database["public"]['Enums']["priority"],"sentiment"?: Database["public"]['Enums']["sentiment"],"severity"?: Database["public"]['Enums']["severity"] | null,"topic"?: string | null
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
                },"department_capabilities": {
                  Row: {
                    "category_id": string,"created_at": string,"department_id": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "category_id": string,"created_at"?: string,"department_id": string,"org_id": string
                  }
                  Update: {
                    "category_id"?: string,"created_at"?: string,"department_id"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "department_capabilities_org_id_category_id_fkey"
      columns: ["org_id","category_id"]
isOneToOne: false
      referencedRelation: "case_categories"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "department_capabilities_org_id_department_id_fkey"
      columns: ["org_id","department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "department_capabilities_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "created_at": string,"head_user_id": string | null,"id": string,"name": string,"org_id": string,"responsible_user_id": string | null,"short_name": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"head_user_id"?: string | null,"id"?: string,"name": string,"org_id": string,"responsible_user_id"?: string | null,"short_name"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"head_user_id"?: string | null,"id"?: string,"name"?: string,"org_id"?: string,"responsible_user_id"?: string | null,"short_name"?: string | null
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
                },"incident_policies": {
                  Row: {
                    "channel": string,"id": string,"incident_type": string,"instructions": string,"org_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channel": string,"id"?: string,"incident_type": string,"instructions": string,"org_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "channel"?: string,"id"?: string,"incident_type"?: string,"instructions"?: string,"org_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "incident_policies_org_id_fkey"
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
                    "can_view_counterintel": boolean,"can_view_officials": boolean,"created_at": string,"department_id": string | null,"id": string,"org_id": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "can_view_counterintel"?: boolean,"can_view_officials"?: boolean,"created_at"?: string,"department_id"?: string | null,"id"?: string,"org_id": string,"role": Database["public"]['Enums']["membership_role"],"user_id": string
                  }
                  Update: {
                    "can_view_counterintel"?: boolean,"can_view_officials"?: boolean,"created_at"?: string,"department_id"?: string | null,"id"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["membership_role"],"user_id"?: string
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
                },"monitor_settings": {
                  Row: {
                    "classify_backlog_minutes": number,"classify_stale_minutes": number,"dashboard_stale_minutes": number,"org_id": string,"review_confidence_below": number,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "classify_backlog_minutes"?: number,"classify_stale_minutes"?: number,"dashboard_stale_minutes"?: number,"org_id": string,"review_confidence_below"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "classify_backlog_minutes"?: number,"classify_stale_minutes"?: number,"dashboard_stale_minutes"?: number,"org_id"?: string,"review_confidence_below"?: number,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "monitor_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
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
                },"notification_events": {
                  Row: {
                    "case_id": string | null,"created_at": string,"cycle": number | null,"deadline": string | null,"dedupe_key": string,"id": string,"kind": string,"level": string | null,"org_id": string,"phase": string | null,"reason": string,"recipient_user_id": string | null,"result": string
                  }
                  ComputedFields: never
                  Insert: {
                    "case_id"?: string | null,"created_at"?: string,"cycle"?: number | null,"deadline"?: string | null,"dedupe_key": string,"id"?: string,"kind": string,"level"?: string | null,"org_id": string,"phase"?: string | null,"reason": string,"recipient_user_id"?: string | null,"result": string
                  }
                  Update: {
                    "case_id"?: string | null,"created_at"?: string,"cycle"?: number | null,"deadline"?: string | null,"dedupe_key"?: string,"id"?: string,"kind"?: string,"level"?: string | null,"org_id"?: string,"phase"?: string | null,"reason"?: string,"recipient_user_id"?: string | null,"result"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_events_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "notification_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_preferences": {
                  Row: {
                    "email": boolean,"org_id": string,"quiet_end": number | null,"quiet_start": number | null,"updated_at": string,"user_id": string,"whatsapp": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "email"?: boolean,"org_id": string,"quiet_end"?: number | null,"quiet_start"?: number | null,"updated_at"?: string,"user_id": string,"whatsapp"?: boolean
                  }
                  Update: {
                    "email"?: boolean,"org_id"?: string,"quiet_end"?: number | null,"quiet_start"?: number | null,"updated_at"?: string,"user_id"?: string,"whatsapp"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_preferences_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_settings": {
                  Row: {
                    "coordinator_after_hours": number,"head_after_hours": number,"id": string,"link_after_hours": number,"max_per_hour": number,"org_id": string,"quiet_end": number,"quiet_start": number,"reminder_percent": number,"updated_at": string,"updated_by": string | null,"whatsapp_enabled": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "coordinator_after_hours"?: number,"head_after_hours"?: number,"id"?: string,"link_after_hours"?: number,"max_per_hour"?: number,"org_id": string,"quiet_end"?: number,"quiet_start"?: number,"reminder_percent"?: number,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_enabled"?: boolean
                  }
                  Update: {
                    "coordinator_after_hours"?: number,"head_after_hours"?: number,"id"?: string,"link_after_hours"?: number,"max_per_hour"?: number,"org_id"?: string,"quiet_end"?: number,"quiet_start"?: number,"reminder_percent"?: number,"updated_at"?: string,"updated_by"?: string | null,"whatsapp_enabled"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
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
                },"onboarding_checks": {
                  Row: {
                    "done_at": string,"done_by": string,"key": string,"note": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "done_at"?: string,"done_by": string,"key": string,"note": string,"org_id": string
                  }
                  Update: {
                    "done_at"?: string,"done_by"?: string,"key"?: string,"note"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "onboarding_checks_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "brand_accent": string,"brand_primary": string,"created_at": string,"id": string,"logo_path": string | null,"logo_updated_at": string | null,"name": string,"slug": string,"state": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand_accent"?: string,"brand_primary"?: string,"created_at"?: string,"id"?: string,"logo_path"?: string | null,"logo_updated_at"?: string | null,"name": string,"slug": string,"state"?: string | null
                  }
                  Update: {
                    "brand_accent"?: string,"brand_primary"?: string,"created_at"?: string,"id"?: string,"logo_path"?: string | null,"logo_updated_at"?: string | null,"name"?: string,"slug"?: string,"state"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"outbox": {
                  Row: {
                    "address": string,"alert_event_id": string | null,"attempts": number,"channel": string,"created_at": string,"deferred_reason": string | null,"event_id": string | null,"id": string,"idempotency_key": string,"kind": string,"last_error": string | null,"lease_expires_at": string | null,"lease_owner": string | null,"max_attempts": number,"next_attempt_at": string,"org_id": string,"payload": NonNullable<Json>,"provider_message_id": string | null,"recipient_user_id": string | null,"report_id": string | null,"sent_at": string | null,"status": string,"updated_at": string,"urgency": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address": string,"alert_event_id"?: string | null,"attempts"?: number,"channel": string,"created_at"?: string,"deferred_reason"?: string | null,"event_id"?: string | null,"id"?: string,"idempotency_key": string,"kind": string,"last_error"?: string | null,"lease_expires_at"?: string | null,"lease_owner"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"org_id": string,"payload"?: NonNullable<Json>,"provider_message_id"?: string | null,"recipient_user_id"?: string | null,"report_id"?: string | null,"sent_at"?: string | null,"status"?: string,"updated_at"?: string,"urgency"?: string
                  }
                  Update: {
                    "address"?: string,"alert_event_id"?: string | null,"attempts"?: number,"channel"?: string,"created_at"?: string,"deferred_reason"?: string | null,"event_id"?: string | null,"id"?: string,"idempotency_key"?: string,"kind"?: string,"last_error"?: string | null,"lease_expires_at"?: string | null,"lease_owner"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"org_id"?: string,"payload"?: NonNullable<Json>,"provider_message_id"?: string | null,"recipient_user_id"?: string | null,"report_id"?: string | null,"sent_at"?: string | null,"status"?: string,"updated_at"?: string,"urgency"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbox_alert_event_id_fkey"
      columns: ["alert_event_id"]
isOneToOne: false
      referencedRelation: "alert_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbox_event_id_fkey"
      columns: ["event_id"]
isOneToOne: false
      referencedRelation: "notification_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbox_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbox_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "reports"
      referencedColumns: ["id"]
    }
                  ]
                },"outbox_attempts": {
                  Row: {
                    "attempt": number,"error": string | null,"finished_at": string | null,"id": number,"org_id": string,"outbox_id": string,"provider_message_id": string | null,"result": string | null,"started_at": string,"worker": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt": number,"error"?: string | null,"finished_at"?: string | null,"id"?: never,"org_id": string,"outbox_id": string,"provider_message_id"?: string | null,"result"?: string | null,"started_at"?: string,"worker": string
                  }
                  Update: {
                    "attempt"?: number,"error"?: string | null,"finished_at"?: string | null,"id"?: never,"org_id"?: string,"outbox_id"?: string,"provider_message_id"?: string | null,"result"?: string | null,"started_at"?: string,"worker"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outbox_attempts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outbox_attempts_outbox_id_fkey"
      columns: ["outbox_id"]
isOneToOne: false
      referencedRelation: "outbox"
      referencedColumns: ["id"]
    }
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
                },"report_job_events": {
                  Row: {
                    "at": string,"error": string | null,"from_stage": string,"id": number,"job_id": string,"ok": boolean,"org_id": string,"to_stage": string,"worker": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"error"?: string | null,"from_stage": string,"id"?: never,"job_id": string,"ok": boolean,"org_id": string,"to_stage": string,"worker": string
                  }
                  Update: {
                    "at"?: string,"error"?: string | null,"from_stage"?: string,"id"?: never,"job_id"?: string,"ok"?: boolean,"org_id"?: string,"to_stage"?: string,"worker"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_job_events_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "report_jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_job_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"report_jobs": {
                  Row: {
                    "attempts": number,"auto_approve": boolean,"created_at": string,"finished_at": string | null,"id": string,"kind": Database["public"]['Enums']["report_period"],"last_error": string | null,"lease_expires_at": string | null,"lease_owner": string | null,"max_attempts": number,"next_attempt_at": string,"org_id": string,"period_end": string,"period_start": string,"recipients": (string)[],"report_id": string | null,"schedule_id": string | null,"stage": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"auto_approve"?: boolean,"created_at"?: string,"finished_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["report_period"],"last_error"?: string | null,"lease_expires_at"?: string | null,"lease_owner"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"org_id": string,"period_end": string,"period_start": string,"recipients"?: (string)[],"report_id"?: string | null,"schedule_id"?: string | null,"stage"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"auto_approve"?: boolean,"created_at"?: string,"finished_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["report_period"],"last_error"?: string | null,"lease_expires_at"?: string | null,"lease_owner"?: string | null,"max_attempts"?: number,"next_attempt_at"?: string,"org_id"?: string,"period_end"?: string,"period_start"?: string,"recipients"?: (string)[],"report_id"?: string | null,"schedule_id"?: string | null,"stage"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_jobs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_jobs_report_id_fkey"
      columns: ["report_id"]
isOneToOne: false
      referencedRelation: "reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_jobs_schedule_id_fkey"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "report_schedules"
      referencedColumns: ["id"]
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
                    "approved_at": string | null,"approved_by": string | null,"content": NonNullable<Json>,"created_at": string,"created_by": string | null,"delivery": NonNullable<Json>,"facts": NonNullable<Json>,"facts_stale_at": string | null,"id": string,"job_id": string | null,"kpi_version": string | null,"model": string | null,"org_id": string,"pdf_path": string | null,"period": Database["public"]['Enums']["report_period"],"period_end": string,"period_start": string,"previous_version_id": string | null,"recipients": (string)[],"schedule_id": string | null,"sent_at": string | null,"snapshot_at": string | null,"status": Database["public"]['Enums']["report_status"],"title": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"delivery"?: NonNullable<Json>,"facts"?: NonNullable<Json>,"facts_stale_at"?: string | null,"id"?: string,"job_id"?: string | null,"kpi_version"?: string | null,"model"?: string | null,"org_id": string,"pdf_path"?: string | null,"period": Database["public"]['Enums']["report_period"],"period_end": string,"period_start": string,"previous_version_id"?: string | null,"recipients"?: (string)[],"schedule_id"?: string | null,"sent_at"?: string | null,"snapshot_at"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "approved_at"?: string | null,"approved_by"?: string | null,"content"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"delivery"?: NonNullable<Json>,"facts"?: NonNullable<Json>,"facts_stale_at"?: string | null,"id"?: string,"job_id"?: string | null,"kpi_version"?: string | null,"model"?: string | null,"org_id"?: string,"pdf_path"?: string | null,"period"?: Database["public"]['Enums']["report_period"],"period_end"?: string,"period_start"?: string,"previous_version_id"?: string | null,"recipients"?: (string)[],"schedule_id"?: string | null,"sent_at"?: string | null,"snapshot_at"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"title"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_job_id_fkey"
      columns: ["job_id"]
isOneToOne: true
      referencedRelation: "report_jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_previous_version_id_fkey"
      columns: ["previous_version_id"]
isOneToOne: false
      referencedRelation: "reports"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_schedule_fk"
      columns: ["schedule_id"]
isOneToOne: false
      referencedRelation: "report_schedules"
      referencedColumns: ["id"]
    }
                  ]
                },"retention_holds": {
                  Row: {
                    "covers_from": string | null,"covers_to": string | null,"created_at": string,"created_by": string,"id": string,"org_id": string,"reason": string,"reference": string | null,"release_reason": string | null,"released_at": string | null,"released_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "covers_from"?: string | null,"covers_to"?: string | null,"created_at"?: string,"created_by": string,"id"?: string,"org_id": string,"reason": string,"reference"?: string | null,"release_reason"?: string | null,"released_at"?: string | null,"released_by"?: string | null
                  }
                  Update: {
                    "covers_from"?: string | null,"covers_to"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string,"org_id"?: string,"reason"?: string,"reference"?: string | null,"release_reason"?: string | null,"released_at"?: string | null,"released_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "retention_holds_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"retention_policies": {
                  Row: {
                    "agreement_date": string | null,"agreement_reference": string | null,"mention_months": number | null,"notes": string,"org_id": string,"paused": boolean,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "agreement_date"?: string | null,"agreement_reference"?: string | null,"mention_months"?: number | null,"notes"?: string,"org_id": string,"paused"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "agreement_date"?: string | null,"agreement_reference"?: string | null,"mention_months"?: number | null,"notes"?: string,"org_id"?: string,"paused"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "retention_policies_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
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
                },"sla_calendars": {
                  Row: {
                    "day_end": string,"day_start": string,"mode": string,"org_id": string,"time_zone": string,"updated_at": string,"workdays": (number)[]
                  }
                  ComputedFields: never
                  Insert: {
                    "day_end"?: string,"day_start"?: string,"mode"?: string,"org_id": string,"time_zone"?: string,"updated_at"?: string,"workdays"?: (number)[]
                  }
                  Update: {
                    "day_end"?: string,"day_start"?: string,"mode"?: string,"org_id"?: string,"time_zone"?: string,"updated_at"?: string,"workdays"?: (number)[]
                  }
                  Relationships: [
                    {
      foreignKeyName: "sla_calendars_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"sla_holidays": {
                  Row: {
                    "day": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "day": string,"name": string,"org_id": string
                  }
                  Update: {
                    "day"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sla_holidays_org_id_fkey"
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
                },"sla_targets": {
                  Row: {
                    "accept_hours": number,"attention_hours": number,"category": string | null,"id": string,"org_id": string,"priority": Database["public"]['Enums']["priority"]
                  }
                  ComputedFields: never
                  Insert: {
                    "accept_hours": number,"attention_hours": number,"category"?: string | null,"id"?: string,"org_id": string,"priority": Database["public"]['Enums']["priority"]
                  }
                  Update: {
                    "accept_hours"?: number,"attention_hours"?: number,"category"?: string | null,"id"?: string,"org_id"?: string,"priority"?: Database["public"]['Enums']["priority"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "sla_targets_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"sla_versions": {
                  Row: {
                    "approval_note": string | null,"approved": boolean,"approved_at": string | null,"approved_by": string | null,"created_at": string,"created_by": string | null,"id": string,"org_id": string,"snapshot": NonNullable<Json>,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "approval_note"?: string | null,"approved"?: boolean,"approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"org_id": string,"snapshot": NonNullable<Json>,"version": number
                  }
                  Update: {
                    "approval_note"?: string | null,"approved"?: boolean,"approved_at"?: string | null,"approved_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"org_id"?: string,"snapshot"?: NonNullable<Json>,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sla_versions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"sources": {
                  Row: {
                    "config": NonNullable<Json>,"consecutive_failures": number,"covered_until": string | null,"created_at": string,"cursor": NonNullable<Json>,"expected_every_minutes": number,"has_secret": boolean,"id": string,"is_active": boolean,"last_error": string | null,"last_error_at": string | null,"last_run_at": string | null,"last_success_at": string | null,"name": string,"org_id": string,"quiet_after_hours": number,"run_lease_id": string | null,"run_lease_until": string | null,"stale_after_minutes": number | null,"type": Database["public"]['Enums']["source_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "config"?: NonNullable<Json>,"consecutive_failures"?: number,"covered_until"?: string | null,"created_at"?: string,"cursor"?: NonNullable<Json>,"expected_every_minutes"?: number,"has_secret"?: boolean,"id"?: string,"is_active"?: boolean,"last_error"?: string | null,"last_error_at"?: string | null,"last_run_at"?: string | null,"last_success_at"?: string | null,"name": string,"org_id": string,"quiet_after_hours"?: number,"run_lease_id"?: string | null,"run_lease_until"?: string | null,"stale_after_minutes"?: number | null,"type": Database["public"]['Enums']["source_type"]
                  }
                  Update: {
                    "config"?: NonNullable<Json>,"consecutive_failures"?: number,"covered_until"?: string | null,"created_at"?: string,"cursor"?: NonNullable<Json>,"expected_every_minutes"?: number,"has_secret"?: boolean,"id"?: string,"is_active"?: boolean,"last_error"?: string | null,"last_error_at"?: string | null,"last_run_at"?: string | null,"last_success_at"?: string | null,"name"?: string,"org_id"?: string,"quiet_after_hours"?: number,"run_lease_id"?: string | null,"run_lease_until"?: string | null,"stale_after_minutes"?: number | null,"type"?: Database["public"]['Enums']["source_type"]
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
                },"stats_invalidations": {
                  Row: {
                    "id": number,"mention_id": string | null,"org_id": string,"processed_at": string | null,"reason": string,"requested_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: never,"mention_id"?: string | null,"org_id": string,"processed_at"?: string | null,"reason": string,"requested_at"?: string
                  }
                  Update: {
                    "id"?: never,"mention_id"?: string | null,"org_id"?: string,"processed_at"?: string | null,"reason"?: string,"requested_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stats_invalidations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"tickets": {
                  Row: {
                    "assigned_at": string,"assignee_id": string | null,"case_id": string | null,"created_at": string,"created_by": string | null,"department_id": string,"due_at": string | null,"id": string,"is_primary": boolean,"mention_id": string,"org_id": string,"resolved_at": string | null,"status": Database["public"]['Enums']["ticket_status"],"whatsapp_escalated_at": string | null,"whatsapp_notified_at": string | null,"whatsapp_reminded_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"assignee_id"?: string | null,"case_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"department_id": string,"due_at"?: string | null,"id"?: string,"is_primary"?: boolean,"mention_id": string,"org_id": string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"],"whatsapp_escalated_at"?: string | null,"whatsapp_notified_at"?: string | null,"whatsapp_reminded_at"?: string | null
                  }
                  Update: {
                    "assigned_at"?: string,"assignee_id"?: string | null,"case_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"department_id"?: string,"due_at"?: string | null,"id"?: string,"is_primary"?: boolean,"mention_id"?: string,"org_id"?: string,"resolved_at"?: string | null,"status"?: Database["public"]['Enums']["ticket_status"],"whatsapp_escalated_at"?: string | null,"whatsapp_notified_at"?: string | null,"whatsapp_reminded_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "tickets_case_fk"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
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
                },"verified_authors": {
                  Row: {
                    "display_name": string,"evidence": string,"evidence_url": string | null,"handle": string,"id": string,"kind": Database["public"]['Enums']["author_kind"],"org_id": string,"platform": Database["public"]['Enums']["source_type"],"revoked_at": string | null,"revoked_by": string | null,"revoked_by_name": string | null,"revoked_reason": string | null,"verified_at": string,"verified_by": string,"verified_by_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "display_name": string,"evidence": string,"evidence_url"?: string | null,"handle": string,"id"?: string,"kind": Database["public"]['Enums']["author_kind"],"org_id": string,"platform": Database["public"]['Enums']["source_type"],"revoked_at"?: string | null,"revoked_by"?: string | null,"revoked_by_name"?: string | null,"revoked_reason"?: string | null,"verified_at"?: string,"verified_by": string,"verified_by_name": string
                  }
                  Update: {
                    "display_name"?: string,"evidence"?: string,"evidence_url"?: string | null,"handle"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["author_kind"],"org_id"?: string,"platform"?: Database["public"]['Enums']["source_type"],"revoked_at"?: string | null,"revoked_by"?: string | null,"revoked_by_name"?: string | null,"revoked_reason"?: string | null,"verified_at"?: string,"verified_by"?: string,"verified_by_name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "verified_authors_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
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
                },"worker_heartbeats": {
                  Row: {
                    "kind": string,"last_error": string | null,"last_finished_at": string | null,"last_ok_at": string | null,"last_started_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"last_error"?: string | null,"last_finished_at"?: string | null,"last_ok_at"?: string | null,"last_started_at"?: string | null
                  }
                  Update: {
                    "kind"?: string,"last_error"?: string | null,"last_finished_at"?: string | null,"last_ok_at"?: string | null,"last_started_at"?: string | null
                  }
                  Relationships: [
                    
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
            "case_cycle_times": {
                  Row: {
                    "accepted_at": string | null,"attention_started_at": string | null,"case_id": string | null,"closed_at": string | null,"cycle": number | null,"first_assigned_at": string | null,"last_assigned_at": string | null,"org_id": string | null,"returns": number | null,"started_at": string | null,"validation_rejections": number | null,"validation_requested_at": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "case_milestones_org_id_case_id_fkey"
      columns: ["org_id","case_id"]
isOneToOne: false
      referencedRelation: "cases"
      referencedColumns: ["org_id","id"]
    },{
      foreignKeyName: "case_milestones_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"mention_stats_hourly": {
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
            "acquire_ai_lease":
{ Args: { "p_holder": string,"p_name": string,"p_org_id": string,"p_ttl_seconds": number }; Returns: boolean
                           },
"add_case_note":
{ Args: { "p_body": string,"p_case_id": string,"p_visibility": string }; Returns: string
                           },
"add_case_task":
{ Args: { "p_case_id": string,"p_department_id": string,"p_detail"?: string,"p_due_at"?: string,"p_responsible_user_id"?: string,"p_title": string }; Returns: string
                           },
"add_case_update":
{ Args: { "p_audience"?: string,"p_body": string,"p_case_id": string,"p_paths"?: (string)[],"p_task_id"?: string }; Returns: string
                           },
"advance_report_job":
{ Args: { "p_error"?: string,"p_id": string,"p_now"?: string,"p_release"?: boolean,"p_report_id"?: string,"p_to_stage": string,"p_worker": string }; Returns: string
                           },
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
"apply_ticket_backfill":
{ Args: { "p_org_id": string }; Returns: Json
                           },
"approve_sla_version":
{ Args: { "p_note"?: string,"p_version_id": string }; Returns: undefined
                           },
"assign_case":
{ Args: { "p_accept_due_at": string,"p_case_id": string,"p_commitment"?: string,"p_department_id": string,"p_due_at": string,"p_reason"?: string,"p_responsible_user_id"?: string,"p_support_ids"?: (string)[] }; Returns: Json
                           },
"can_view_counterintel":
{ Args: { "p_org_id": string }; Returns: boolean
                           },
"can_view_officials":
{ Args: { "p_org_id": string }; Returns: boolean
                           },
"case_add_mentions":
{ Args: { "p_case_id": string,"p_mention_ids": (string)[],"p_reason"?: string }; Returns: number
                           },
"case_areas":
{ Args: { "p_case_id": string }; Returns: {
              "department_id": string,"is_primary": boolean
            }[]
                           },
"case_people":
{ Args: { "p_case_id": string }; Returns: {
              "is_responsible": boolean,"name": string,"user_id": string
            }[]
                           },
"case_remove_mention":
{ Args: { "p_case_id": string,"p_mention_id": string,"p_reason": string }; Returns: undefined
                           },
"case_ticket_status":
{ Args: { "p_status": Database["public"]['Enums']["ticket_status"],"p_ticket_id": string }; Returns: Json
                           },
"case_transition_actor":
{ Args: { "p_from": Database["public"]['Enums']["case_status"],"p_to": Database["public"]['Enums']["case_status"] }; Returns: string
                           },
"case_transition_allowed":
{ Args: { "p_from": Database["public"]['Enums']["case_status"],"p_to": Database["public"]['Enums']["case_status"] }; Returns: boolean
                           },
"case_transition_by_department":
{ Args: { "p_from": Database["public"]['Enums']["case_status"],"p_to": Database["public"]['Enums']["case_status"] }; Returns: boolean
                           },
"case_transition_needs_reason":
{ Args: { "p_from": Database["public"]['Enums']["case_status"],"p_to": Database["public"]['Enums']["case_status"] }; Returns: boolean
                           },
"ci_overview":
{ Args: { "p_from": string,"p_org_id": string }; Returns: Json
                           },
"claim_mentions":
{ Args: { "p_claim_id": string,"p_lease_seconds": number,"p_limit": number,"p_max_attempts": number }; Returns: {
              "attempts": number,"author_kind": Database["public"]['Enums']["author_kind"],"author_name": string,"id": string,"org_id": string,"project_id": string,"published_at": string,"source_name": string,"source_type": Database["public"]['Enums']["source_type"],"text": string
            }[]
                           },
"claim_outbox":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number,"p_now"?: string,"p_worker": string }; Returns: {
              "address": string,
"alert_event_id": string | null,
"attempts": number,
"channel": string,
"created_at": string,
"deferred_reason": string | null,
"event_id": string | null,
"id": string,
"idempotency_key": string,
"kind": string,
"last_error": string | null,
"lease_expires_at": string | null,
"lease_owner": string | null,
"max_attempts": number,
"next_attempt_at": string,
"org_id": string,
"payload": NonNullable<Json>,
"provider_message_id": string | null,
"recipient_user_id": string | null,
"report_id": string | null,
"sent_at": string | null,
"status": string,
"updated_at": string,
"urgency": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "outbox"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_report_jobs":
{ Args: { "p_lease_seconds"?: number,"p_limit"?: number,"p_now"?: string,"p_worker": string }; Returns: {
              "attempts": number,
"auto_approve": boolean,
"created_at": string,
"finished_at": string | null,
"id": string,
"kind": Database["public"]['Enums']["report_period"],
"last_error": string | null,
"lease_expires_at": string | null,
"lease_owner": string | null,
"max_attempts": number,
"next_attempt_at": string,
"org_id": string,
"period_end": string,
"period_start": string,
"recipients": (string)[],
"report_id": string | null,
"schedule_id": string | null,
"stage": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "report_jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"claim_sources":
{ Args: { "p_lease_id": string,"p_lease_seconds": number,"p_limit": number,"p_min_gap_seconds"?: number,"p_org_id"?: string,"p_respect_backoff"?: boolean,"p_source_ids"?: (string)[],"p_types": (Database["public"]['Enums']["source_type"])[] }; Returns: {
              "config": NonNullable<Json>,
"consecutive_failures": number,
"covered_until": string | null,
"created_at": string,
"cursor": NonNullable<Json>,
"expected_every_minutes": number,
"has_secret": boolean,
"id": string,
"is_active": boolean,
"last_error": string | null,
"last_error_at": string | null,
"last_run_at": string | null,
"last_success_at": string | null,
"name": string,
"org_id": string,
"quiet_after_hours": number,
"run_lease_id": string | null,
"run_lease_until": string | null,
"stale_after_minutes": number | null,
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
"clear_case_location":
{ Args: { "p_case_id": string,"p_reason": string }; Returns: undefined
                           },
"clear_source_secret":
{ Args: { "p_source_id": string }; Returns: undefined
                           },
"complete_classifications":
{ Args: { "p_claim_id": string,"p_failures": Json,"p_max_attempts": number,"p_results": Json }; Returns: Json
                           },
"complete_outbox":
{ Args: { "p_attempt": number,"p_error"?: string,"p_id": string,"p_now"?: string,"p_ok": boolean,"p_provider_id"?: string,"p_retryable"?: boolean,"p_worker": string }; Returns: string
                           },
"confirm_classification":
{ Args: { "p_mention_id": string }; Returns: undefined
                           },
"correct_classification":
{ Args: { "p_changes": Json,"p_mention_id": string,"p_reason"?: string }; Returns: Json
                           },
"create_case":
{ Args: { "p_category"?: string,"p_description"?: string,"p_mention_ids": (string)[],"p_neighborhood_id"?: string,"p_org_id": string,"p_priority"?: Database["public"]['Enums']["priority"],"p_title": string }; Returns: string
                           },
"crisis_snapshot":
{ Args: { "p_minutes"?: number,"p_org_id": string }; Returns: Json
                           },
"dashboard_stats":
{ Args: { "p_bucket"?: string,"p_detail"?: boolean,"p_from": string,"p_org_id": string,"p_to": string }; Returns: Json
                           },
"decide_review":
{ Args: { "p_changes"?: Json,"p_decision": string,"p_reason"?: string,"p_review_id": string }; Returns: Json
                           },
"delete_project":
{ Args: { "p_project_id": string }; Returns: Json
                           },
"department_people":
{ Args: { "p_org_id": string }; Returns: {
              "department_id": string,"name": string,"user_id": string
            }[]
                           },
"enqueue_case_escalations":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: Json
                           },
"enqueue_outbox":
{ Args: { "p_address": string,"p_alert_event_id"?: string,"p_channel": string,"p_event_id"?: string,"p_key": string,"p_kind": string,"p_org_id": string,"p_payload": Json,"p_recipient_user_id"?: string,"p_report_id"?: string,"p_urgency"?: string }; Returns: string
                           },
"enqueue_report_job":
{ Args: { "p_auto_approve": boolean,"p_end": string,"p_kind": Database["public"]['Enums']["report_period"],"p_org_id": string,"p_recipients": (string)[],"p_schedule_id": string,"p_start": string }; Returns: Json
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
"inbox_counts":
{ Args: { "p_filters"?: Json,"p_org_id": string }; Returns: Json
                           },
"inbox_items":
{ Args: { "p_filters"?: Json,"p_org_id": string }; Returns: {
              "awaiting_acceptance": boolean,"awaiting_validation": boolean,"due_at": string,"id": string,"is_new": boolean,"is_overdue": boolean,"is_unassigned": boolean,"is_urgent": boolean,"item_at": string,"kind": string,"urgency": number
            }[]
                           },
"inbox_queue":
{ Args: { "p_cursor"?: Json,"p_filters"?: Json,"p_limit"?: number,"p_org_id": string,"p_view": string }; Returns: {
              "due_at": string,"id": string,"item_at": string,"kind": string,"urgency": number
            }[]
                           },
"ingest_mentions":
{ Args: { "p_org_id": string,"p_rows": Json,"p_source_id": string }; Returns: Json
                           },
"invite_whatsapp_contact":
{ Args: { "p_org_id": string,"p_phone": string,"p_user_id": string }; Returns: string
                           },
"kpi_snapshot":
{ Args: { "p_bucket"?: string,"p_from": string,"p_org_id": string,"p_prev_from": string,"p_prev_to": string,"p_to": string }; Returns: Json
                           },
"log_event":
{ Args: { "p_action": string,"p_details"?: Json,"p_entity": string,"p_entity_id": string,"p_org_id": string }; Returns: undefined
                           },
"log_export":
{ Args: { "p_filters": Json,"p_kind": string,"p_org_id": string,"p_rows": number }; Returns: undefined
                           },
"map_case_rows":
{ Args: { "p_filters"?: Json,"p_org_id": string }; Returns: {
              "category": string,"department_id": string,"folio": string,"id": string,"lat": number,"lng": number,"location_confidence": number,"location_status": string,"neighborhood_id": string,"opened_at": string,"overdue": boolean,"priority": Database["public"]['Enums']["priority"],"status": Database["public"]['Enums']["case_status"]
            }[]
                           },
"map_stats":
{ Args: { "p_department"?: string,"p_from": string,"p_org_id": string,"p_prev_from": string,"p_sentiment"?: Database["public"]['Enums']["sentiment"],"p_to": string,"p_topic"?: string }; Returns: Json
                           },
"map_unlocated_mentions":
{ Args: { "p_department"?: string,"p_from": string,"p_limit"?: number,"p_org_id": string,"p_sentiment"?: Database["public"]['Enums']["sentiment"],"p_to": string,"p_topic"?: string }; Returns: Json
                           },
"mention_stats":
{ Args: { "p_from": string,"p_org_id": string,"p_to": string }; Returns: {
              "department_id": string,"hour": string,"interactions": number,"mentions": number,"sentiment": Database["public"]['Enums']["sentiment"]
            }[]
                           },
"merge_cases":
{ Args: { "p_reason": string,"p_source_ids": (string)[],"p_target_id": string }; Returns: number
                           },
"monitor_health":
{ Args: { "p_org_id": string }; Returns: Json
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
"process_stats_invalidations":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"purge_old_mentions":
{ Args: { "p_batch"?: number,"p_months": number }; Returns: number
                           },
"purge_old_whatsapp_messages":
{ Args: { "p_months": number }; Returns: number
                           },
"purge_org_mentions":
{ Args: { "p_basis"?: string,"p_batch"?: number,"p_months": number,"p_org_id": string }; Returns: number
                           },
"rate_limit_hit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: {
              "allowed": boolean,"remaining": number,"reset_at": string
            }[]
                           },
"reapply_sla":
{ Args: { "p_case_ids": (string)[],"p_include_overridden"?: boolean,"p_org_id": string,"p_reason": string }; Returns: number
                           },
"record_ai_usage":
{ Args: { "p_cache_read_tokens": number,"p_cache_write_tokens": number,"p_cost_usd": number,"p_input_tokens": number,"p_model": string,"p_org_id": string,"p_output_tokens": number,"p_purpose": string }; Returns: undefined
                           },
"record_heartbeat":
{ Args: { "p_error"?: string,"p_kind": string,"p_phase": string }; Returns: undefined
                           },
"refresh_mention_stats":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"release_ai":
{ Args: { "p_call_id": string,"p_error": string }; Returns: boolean
                           },
"release_ai_lease":
{ Args: { "p_holder": string,"p_name": string,"p_org_id": string }; Returns: undefined
                           },
"release_mentions":
{ Args: { "p_claim_id": string,"p_count_attempt"?: boolean,"p_error"?: string,"p_ids": (string)[] }; Returns: number
                           },
"remove_whatsapp_contact":
{ Args: { "p_org_id": string,"p_user_id": string }; Returns: undefined
                           },
"reopen_case":
{ Args: { "p_case_id": string,"p_paths"?: (string)[],"p_reason": string }; Returns: Json
                           },
"report_context":
{ Args: { "p_bucket"?: string,"p_from": string,"p_org_id": string,"p_to": string }; Returns: Json
                           },
"report_extras":
{ Args: { "p_bucket"?: string,"p_from": string,"p_org_id": string,"p_peaks"?: (string)[],"p_to": string }; Returns: Json
                           },
"report_snapshot":
{ Args: { "p_bucket"?: string,"p_from": string,"p_org_id": string,"p_prev_from": string,"p_prev_to": string,"p_to": string }; Returns: Json
                           },
"reserve_ai":
{ Args: { "p_estimated_tokens": number,"p_estimated_usd": number,"p_model": string,"p_org_id": string,"p_purpose": string,"p_ttl_seconds"?: number,"p_user_id": string }; Returns: {
              "allowed": boolean,"call_id": string,"message": string,"reason": string
            }[]
                           },
"resolve_pipeline_failure":
{ Args: { "p_action": string,"p_failure_id": string }; Returns: undefined
                           },
"retention_preview":
{ Args: { "p_months": number,"p_org_id": string }; Returns: Json
                           },
"retry_outbox":
{ Args: { "p_id": string }; Returns: undefined
                           },
"revoke_author":
{ Args: { "p_entry_id": string,"p_reason": string }; Returns: undefined
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
"save_sla_config":
{ Args: { "p_calendar": Json,"p_holidays": Json,"p_org_id": string,"p_targets": Json }; Returns: Json
                           },
"set_case_location":
{ Args: { "p_case_id": string,"p_lat"?: number,"p_lng"?: number,"p_neighborhood_id": string,"p_reason"?: string }; Returns: Json
                           },
"set_department_contacts":
{ Args: { "p_department_id": string,"p_head_user_id": string,"p_link_user_id": string }; Returns: undefined
                           },
"set_report_recipients":
{ Args: { "p_recipients": (string)[],"p_report_id": string }; Returns: (string)[]
                           },
"set_source_secret":
{ Args: { "p_secret": string,"p_source_id": string }; Returns: undefined
                           },
"settle_ai":
{ Args: { "p_cache_read_tokens": number,"p_cache_write_tokens": number,"p_call_id": string,"p_cost_usd": number,"p_input_tokens": number,"p_model": string,"p_output_tokens": number,"p_tariff_version": string }; Returns: boolean
                           },
"simulate_ticket_backfill":
{ Args: { "p_org_id": string }; Returns: Json
                           },
"sla_deadline":
{ Args: { "p_hours": number,"p_org_id": string,"p_start": string }; Returns: string
                           },
"sla_reapply_preview":
{ Args: { "p_case_ids"?: (string)[],"p_include_overridden"?: boolean,"p_org_id": string }; Returns: {
              "accept_from": string,"accept_to": string,"applies": boolean,"case_id": string,"due_from": string,"due_to": string,"folio": string,"overridden": boolean,"status": Database["public"]['Enums']["case_status"],"version_from": number,"version_to": number
            }[]
                           },
"sla_terms":
{ Args: { "p_category": string,"p_org_id": string,"p_priority": Database["public"]['Enums']["priority"],"p_start"?: string }; Returns: Json
                           },
"source_labels":
{ Args: { "p_org_id": string }; Returns: {
              "id": string,"name": string,"type": Database["public"]['Enums']["source_type"]
            }[]
                           },
"stats_invalidation_status":
{ Args: { "p_org_id": string }; Returns: Json
                           },
"suggest_case_mentions":
{ Args: { "p_case_id": string,"p_limit"?: number }; Returns: {
              "hours_apart": number,"mention_id": string,"same_neighborhood": boolean,"same_topic": boolean,"score": number,"word_overlap": number
            }[]
                           },
"transition_case":
{ Args: { "p_case_id": string,"p_department_id"?: string,"p_due_at"?: string,"p_reason"?: string,"p_support_ids"?: (string)[],"p_to": Database["public"]['Enums']["case_status"] }; Returns: Json
                           },
"update_case":
{ Args: { "p_case_id": string,"p_fields": Json }; Returns: undefined
                           },
"update_case_task":
{ Args: { "p_note"?: string,"p_status": Database["public"]['Enums']["case_task_status"],"p_task_id": string }; Returns: undefined
                           },
"upsert_authors":
{ Args: { "p_org_id": string,"p_rows": Json,"p_source_id": string }; Returns: {
              "author_id": string,"handle": string,"platform": Database["public"]['Enums']["source_type"]
            }[]
                           },
"validate_case":
{ Args: { "p_case_id": string,"p_decision": string,"p_evidence_sufficient"?: boolean,"p_note": string }; Returns: Json
                           },
"verify_author":
{ Args: { "p_display_name": string,"p_evidence": string,"p_evidence_url": string,"p_handle": string,"p_kind": Database["public"]['Enums']["author_kind"],"p_org_id": string,"p_platform": Database["public"]['Enums']["source_type"] }; Returns: string
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
            "author_kind": "media"|"public_figure"|"citizen","case_status": "new"|"in_review"|"assigned"|"accepted"|"in_progress"|"resolved"|"closed"|"returned"|"discarded"|"merged","case_task_status": "pending"|"in_progress"|"done"|"cancelled","membership_role": "admin"|"comunicacion"|"dependencia"|"lectura","mention_status": "pending"|"classified"|"failed","priority": "low"|"medium"|"high"|"critical","report_period": "daily"|"weekly"|"monthly","report_status": "draft"|"approved"|"sent","sentiment": "positive"|"neutral"|"negative","severity": "none"|"low"|"moderate"|"high"|"emergency","source_type": "meta"|"rss"|"youtube"|"x"|"bluesky"|"reddit"|"rss_bridge"|"apify","ticket_status": "open"|"in_progress"|"resolved"|"closed","triage_status": "new"|"reviewed"|"routed"|"discarded","whatsapp_contact_status": "pending"|"active"|"declined"|"opted_out"
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
            "author_kind": ["media", "public_figure", "citizen"],"case_status": ["new", "in_review", "assigned", "accepted", "in_progress", "resolved", "closed", "returned", "discarded", "merged"],"case_task_status": ["pending", "in_progress", "done", "cancelled"],"membership_role": ["admin", "comunicacion", "dependencia", "lectura"],"mention_status": ["pending", "classified", "failed"],"priority": ["low", "medium", "high", "critical"],"report_period": ["daily", "weekly", "monthly"],"report_status": ["draft", "approved", "sent"],"sentiment": ["positive", "neutral", "negative"],"severity": ["none", "low", "moderate", "high", "emergency"],"source_type": ["meta", "rss", "youtube", "x", "bluesky", "reddit", "rss_bridge", "apify"],"ticket_status": ["open", "in_progress", "resolved", "closed"],"triage_status": ["new", "reviewed", "routed", "discarded"],"whatsapp_contact_status": ["pending", "active", "declined", "opted_out"]
          }
        }
} as const
