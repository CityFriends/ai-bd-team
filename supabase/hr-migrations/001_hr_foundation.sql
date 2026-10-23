-- ============================================================
-- HR Foundation — Employee Directory, Roles, and Audit
--
-- Target: Dedicated HR Supabase project (NOT the BD project)
-- DO NOT execute against bvgtfadggtgnakrxvuim
-- ============================================================

-- Employee Directory
CREATE TABLE IF NOT EXISTS hr_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_user_id TEXT UNIQUE,
  email TEXT,
  full_name TEXT NOT NULL,
  preferred_name TEXT,

  employment_status TEXT NOT NULL
    CHECK (employment_status IN (
      'active', 'onboarding', 'offboarding', 'inactive', 'terminated'
    )),

  employment_classification TEXT
    CHECK (employment_classification IN (
      'full_time', 'part_time', 'contractor', '1099'
    )),

  work_state TEXT,
  start_date DATE,
  end_date DATE,
  contract_assignment TEXT,

  -- M1: All records must be synthetic.
  -- Database constraint prevents production records via any access path,
  -- including direct SQL with service_role credentials.
  -- Phase 2: ALTER TABLE hr_employees DROP CONSTRAINT hr_employees_synthetic_only;
  is_synthetic BOOLEAN NOT NULL DEFAULT true
    CONSTRAINT hr_employees_synthetic_only CHECK (is_synthetic = true),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,
  updated_by TEXT
);

CREATE INDEX idx_hr_employees_status ON hr_employees(employment_status);
CREATE INDEX idx_hr_employees_state ON hr_employees(work_state) WHERE work_state IS NOT NULL;

-- HR User Roles
CREATE TABLE IF NOT EXISTS hr_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slack_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'hr_admin', 'manager', 'employee')),
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  UNIQUE(slack_user_id, role)
);

CREATE INDEX idx_hr_roles_user ON hr_user_roles(slack_user_id) WHERE revoked_at IS NULL;

-- HR Audit Events (append-only)
CREATE TABLE IF NOT EXISTS hr_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'system', 'ai')),
  actor_id TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  correlation_id TEXT,
  idempotency_key TEXT,
  -- SHA-256 hex digest of the canonical request.
  -- Binds the idempotency key to the exact operation + target + payload.
  -- A replay with the same key but different request is rejected.
  request_fingerprint TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hr_audit_actor ON hr_audit_events(actor_id);
CREATE INDEX idx_hr_audit_target ON hr_audit_events(target_type, target_id);
CREATE INDEX idx_hr_audit_type ON hr_audit_events(event_type);
CREATE UNIQUE INDEX idx_hr_audit_idempotency ON hr_audit_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE hr_employees IS 'Employee directory. M1: synthetic records only.';
COMMENT ON TABLE hr_user_roles IS 'Role-based access control for HR operations.';
COMMENT ON TABLE hr_audit_events IS 'Append-only audit trail. No sensitive payloads.';
