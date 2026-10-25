-- IB-001 Database Schema Alignment Migration

-- 1. Add the status column to the tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('CREATED', 'PUBLISHED', 'EXPIRED', 'CANCELLED'));

-- This migration intentionally uses 'PUBLISHED' as the default for existing tasks to keep them visible.
