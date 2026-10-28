PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone_number TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN','CHIEF_ENGINEER','TEAM_LEADER','TEAM_MEMBER')),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_active TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subsystems (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  -- Three-letter code matching the parts-workbook tab (AER, BRK, CHS, ...).
  -- The spreadsheet import joins on this, not on the English name, so a tab can
  -- be renamed on either side without breaking the mapping.
  code TEXT,
  -- Share of the vehicle mass and build budget allocated to this subsystem,
  -- as a fraction (0.26 = 26%). Set by the Chief Engineer; mirrors the
  -- 'Vehicle Targets' tab of the parts workbook.
  mass_share REAL,
  budget_share REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subsystems_code ON subsystems(code) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS subsystem_members (
  id TEXT PRIMARY KEY,
  subsystem_id TEXT NOT NULL REFERENCES subsystems(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_in_subsystem TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role_in_subsystem IN ('LEADER','MEMBER')),
  UNIQUE(subsystem_id, user_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY,
  part_name TEXT NOT NULL,
  part_number TEXT,
  manufacturer TEXT,
  category TEXT,
  subsystem_id TEXT NOT NULL REFERENCES subsystems(id) ON DELETE CASCADE,
  description TEXT,
  quantity_required INTEGER NOT NULL DEFAULT 1,
  quantity_owned INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'NEEDED' CHECK (status IN (
    'OWNED','PARTIALLY_OWNED','NEEDED','ORDERED','BACKORDERED',
    'MANUFACTURING','AVAILABLE_FOR_INSTALLATION','INSTALLED','NO_LONGER_NEEDED','UNAVAILABLE'
  )),
  importance TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (importance IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  priority_score INTEGER NOT NULL DEFAULT 5,
  estimated_cost REAL,
  actual_cost REAL,
  shipping_cost REAL,
  lead_time_days INTEGER,
  estimated_delivery_date TEXT,
  date_ordered TEXT,
  date_received TEXT,
  purchase_order_number TEXT,
  purchase_url TEXT,
  manufacturer_url TEXT,
  supplier TEXT,
  supplier_part_number TEXT,
  weight_kg REAL,
  dimensions TEXT,
  material TEXT,
  operating_specifications TEXT,
  required_by_date TEXT,
  cad_status TEXT DEFAULT 'NOT_STARTED',
  documentation_status TEXT DEFAULT 'NONE',
  owner_user_id TEXT REFERENCES users(id),
  -- Shopping List workflow (distinct from the ownership `status` above)
  purchase_status TEXT NOT NULL DEFAULT 'NEEDED' CHECK (purchase_status IN (
    'NEEDED','RESEARCHING','AWAITING_APPROVAL','APPROVED','ORDERED','RECEIVED','NO_LONGER_NEEDED'
  )),
  approval_status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (approval_status IN ('PENDING','APPROVED','REJECTED')),
  requested_by TEXT REFERENCES users(id),

  -- ---- Parts-workbook fields (added v2) ----
  -- Permanent line ID from the subsystem tab, e.g. 'PWT-001'. Never reused by
  -- the workbook, so it is the join key for re-import. NULL for parts created
  -- in the dashboard rather than imported.
  sheet_ref TEXT,
  -- Design maturity. A SEPARATE axis from purchase_status above: a part can be
  -- design-FROZEN and purchase-NEEDED at the same time.
  design_status TEXT NOT NULL DEFAULT 'PLACEHOLDER' CHECK (design_status IN (
    'PLACEHOLDER','CANDIDATE','QUOTED','SELECTED','FROZEN'
  )),
  -- Cost is a range until a vendor quote lands. estimated_cost stays as the
  -- single working figure (the midpoint); these two preserve the real spread.
  -- All three are PER UNIT. Line cost is value x quantity_required.
  estimated_cost_low REAL,
  estimated_cost_high REAL,
  -- FSAE rule clause(s) this part must satisfy, e.g. 'T.5.1; T.5.2'.
  governing_rule TEXT,
  -- Which vehicle target drives this line, e.g. 'Target peak power (hp)'.
  driving_target TEXT,
  -- Written definition of done. Required before design_status may reach SELECTED.
  acceptance_criterion TEXT,
  sponsor_ask TEXT CHECK (sponsor_ask IS NULL OR sponsor_ask IN ('CASH','IN_KIND','DISCOUNT','BUY')),
  -- ea / lot / ft / sheet / part / hr. Without this, quantity_required is ambiguous.
  unit_of_measure TEXT,
  -- Target mass per unit assigned by the subsystem lead, against which the real
  -- measured weight_kg is checked. Both per unit, both kilograms.
  allocated_mass_kg REAL,
  -- Optional finer grouping within the subsystem — Engine, Intake, Fuel System,
  -- Cooling and Exhaust are subteams of Powertrain, not subsystems of their own.
  -- Without this column, folding them into Powertrain would lose which area a
  -- part belongs to.
  subteam_id TEXT REFERENCES subteams(id) ON DELETE SET NULL,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_sheet_ref ON parts(sheet_ref) WHERE sheet_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS part_suppliers (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  cost REAL,
  lead_time_days INTEGER,
  url TEXT,
  is_preferred INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS part_dependencies (
  id TEXT PRIMARY KEY,
  part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  depends_on_part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  UNIQUE(part_id, depends_on_part_id)
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  tool_category TEXT,
  manufacturer TEXT,
  model_number TEXT,
  serial_number TEXT,
  asset_number TEXT,
  description TEXT,
  quantity_owned INTEGER NOT NULL DEFAULT 1,
  storage_location TEXT,
  storage_area TEXT,
  responsible_subsystem_id TEXT REFERENCES subsystems(id),
  condition TEXT NOT NULL DEFAULT 'GOOD' CHECK (condition IN ('GOOD','WORN','DAMAGED','NEEDS_CALIBRATION')),
  calibration_date TEXT,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN (
    'AVAILABLE','IN_USE','CHECKED_OUT','UNDER_MAINTENANCE','MISSING','DAMAGED','RETIRED','NEEDS_CALIBRATION'
  )),
  date_acquired TEXT,
  purchase_cost REAL,
  replacement_cost REAL,
  instructions TEXT,
  safety_requirements TEXT,
  notes TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tool_subsystems (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  subsystem_id TEXT NOT NULL REFERENCES subsystems(id) ON DELETE CASCADE,
  UNIQUE(tool_id, subsystem_id)
);

CREATE TABLE IF NOT EXISTS tool_parts (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  UNIQUE(tool_id, part_id)
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'OTHER' CHECK (doc_type IN (
    'SERVICE_MANUAL','INSTALLATION_INSTRUCTIONS','CAD_MODEL','DATASHEET',
    'WIRING_DIAGRAM','VIDEO','URL','TECHNICAL_NOTE','PDF','IMAGE','SPREADSHEET','OTHER'
  )),
  url TEXT,
  subsystem_id TEXT REFERENCES subsystems(id) ON DELETE CASCADE,
  part_id TEXT REFERENCES parts(id) ON DELETE CASCADE,
  procedure_id TEXT REFERENCES procedures(id) ON DELETE CASCADE,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  calendar_event_id TEXT REFERENCES calendar_events(id) ON DELETE CASCADE,
  manufacturer TEXT,
  category TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'LINK' CHECK (source IN ('LINK','UPLOAD')),
  file_path TEXT,
  mime_type TEXT,
  file_size INTEGER,
  original_filename TEXT,
  uploaded_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Procedures: the team's standardized-operating-procedure knowledge base
-- (formerly "Instructions"; renamed throughout the product per policy).
CREATE TABLE IF NOT EXISTS procedures (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'GENERAL' CHECK (category IN (
    'DASHBOARD_USAGE','NAMING_CONVENTIONS','CAD_STANDARDS','DESIGN_DOCUMENTATION',
    'DRAWING_RELEASE','DESIGN_REVIEW','PROCUREMENT','MANUFACTURING','TESTING',
    'DESIGN_CHANGE','FILE_STORAGE','GENERAL'
  )),
  description TEXT,
  purpose TEXT,
  applicable_teams TEXT, -- comma-separated subsystem names, or "All Teams"
  part_id TEXT REFERENCES parts(id) ON DELETE CASCADE,
  tool_id TEXT REFERENCES tools(id) ON DELETE CASCADE,
  subsystem_id TEXT REFERENCES subsystems(id) ON DELETE CASCADE,
  required_documentation TEXT,
  supporting_links TEXT,
  safety_warning TEXT,
  revision_number TEXT NOT NULL DEFAULT '1.0',
  author_id TEXT REFERENCES users(id),
  approval_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (approval_status IN ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED')),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS procedure_steps (
  id TEXT PRIMARY KEY,
  procedure_id TEXT NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  media_url TEXT
);

-- ============ PURCHASING: Requests -> Orders -> Receiving ============

CREATE TABLE IF NOT EXISTS purchase_requests (
  id TEXT PRIMARY KEY,
  request_number TEXT UNIQUE NOT NULL,
  requesting_user_id TEXT NOT NULL REFERENCES users(id),
  subsystem_id TEXT REFERENCES subsystems(id),
  part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  item_description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  estimated_cost REAL,
  vendor TEXT,
  product_link TEXT,
  justification TEXT,
  project_association TEXT,
  required_date TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','CANCELLED','CONVERTED_TO_PO'
  )),
  submitted_at TEXT,
  decided_by TEXT REFERENCES users(id),
  decided_at TEXT,
  decision_note TEXT,
  purchase_order_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_request_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('STATUS_CHANGE','COMMENT','INFO_REQUESTED','DOCUMENT_ADDED')),
  from_status TEXT,
  to_status TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  po_number TEXT UNIQUE NOT NULL,
  purchase_request_id TEXT REFERENCES purchase_requests(id),
  vendor TEXT,
  subsystem_id TEXT REFERENCES subsystems(id),
  created_by TEXT REFERENCES users(id),
  approved_by TEXT REFERENCES users(id),
  approved_at TEXT,
  date_ordered TEXT,
  expected_delivery_date TEXT,
  actual_delivery_date TEXT,
  budget_category TEXT,
  payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID','PAID','REIMBURSED')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT','AWAITING_APPROVAL','APPROVED','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CLOSED','CANCELLED'
  )),
  tracking_number TEXT,
  vendor_order_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS po_line_items (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  description TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cost REAL NOT NULL DEFAULT 0,
  received_quantity INTEGER NOT NULL DEFAULT 0,
  product_link TEXT,
  part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS po_receipts (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_item_id TEXT REFERENCES po_line_items(id) ON DELETE SET NULL,
  quantity_received INTEGER NOT NULL DEFAULT 1,
  condition TEXT NOT NULL DEFAULT 'GOOD' CHECK (condition IN ('GOOD','DAMAGED','INCORRECT_ITEM')),
  date_received TEXT NOT NULL DEFAULT (datetime('now')),
  received_by TEXT REFERENCES users(id),
  storage_location TEXT,
  notes TEXT
);

-- ============ CALENDAR ============

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'DEADLINE' CHECK (event_type IN (
    'DEADLINE','MEETING','MILESTONE','REVIEW','COMPETITION','MANUFACTURING','TESTING','ADMINISTRATIVE'
  )),
  subsystem_id TEXT REFERENCES subsystems(id),
  responsible_user_id TEXT REFERENCES users(id),
  deadline_date TEXT NOT NULL,
  deadline_time TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  links TEXT,
  is_actionable INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING','IN_PROGRESS','SUBMITTED_FOR_REVIEW','COMPLETED')),
  reminder_intervals TEXT NOT NULL DEFAULT '[7,1]', -- JSON array of days-before
  notify_scope TEXT NOT NULL DEFAULT 'TEAM' CHECK (notify_scope IN ('EVERYONE','TEAM','SUBSYSTEM','ASSIGNED_USER','TEAM_LEADS','ADMINS')),
  completion_summary TEXT,
  submitted_by TEXT REFERENCES users(id),
  submitted_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  return_reason TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_reminder_log (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(event_id, days_before)
);

-- ============ MESSAGING (lightweight, polling-based) ============

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id),
  channel_type TEXT NOT NULL CHECK (channel_type IN ('DIRECT','TEAM')),
  channel_key TEXT NOT NULL, -- for DIRECT: sorted "userA:userB"; for TEAM: subsystem_id
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS message_reads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_key TEXT NOT NULL,
  last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, channel_key)
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_key, created_at);

CREATE TABLE IF NOT EXISTS subteams (
  id TEXT PRIMARY KEY,
  subsystem_id TEXT NOT NULL REFERENCES subsystems(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(subsystem_id, name)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('CRITICAL','HIGH','MEDIUM','LOW')),
  subsystem_id TEXT REFERENCES subsystems(id) ON DELETE CASCADE,
  subteam_id TEXT REFERENCES subteams(id) ON DELETE SET NULL,
  part_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  procedure_id TEXT REFERENCES procedures(id) ON DELETE SET NULL,
  assigned_to TEXT REFERENCES users(id) ON DELETE SET NULL, -- primary/legacy single assignee
  assignment_scope TEXT NOT NULL DEFAULT 'USER' CHECK (assignment_scope IN ('USER','TEAM','SUBSYSTEM')),
  created_by TEXT REFERENCES users(id),
  estimated_hours REAL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN','IN_PROGRESS','SUBMITTED_FOR_REVIEW','COMPLETED'
  )),
  due_date TEXT,
  due_time TEXT,
  completion_summary TEXT,
  completion_links TEXT,
  remaining_work TEXT,
  submitted_by TEXT REFERENCES users(id),
  submitted_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  return_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_assignees (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(task_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  blocked_by_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE(task_id, blocked_by_task_id)
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vehicle-level targets and assumptions, mirroring the 'Vehicle Targets' tab.
-- Key/value rather than columns because the Chief Engineer adds targets over
-- time and a schema change per target is not worth it.
CREATE TABLE IF NOT EXISTS vehicle_targets (
  id TEXT PRIMARY KEY,
  target_key TEXT UNIQUE NOT NULL,          -- 'target_vehicle_mass_lb'
  label TEXT NOT NULL,                      -- 'Target vehicle mass, no driver (lb)'
  value_numeric REAL,
  value_text TEXT,
  unit TEXT,
  source TEXT,                              -- 'Placeholder', 'Selected', 'User-stated goal'
  is_placeholder INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Interface register. part_dependencies is a bare (part, depends_on) pair and
-- cannot carry priority, owner, due date or status, so the register gets its
-- own table. Either side may be unresolved: the workbook seeds one side first.
CREATE TABLE IF NOT EXISTS interfaces (
  id TEXT PRIMARY KEY,
  -- Register ID, e.g. 'CHS_SUS_001'. Permanent, never reused.
  interface_ref TEXT UNIQUE NOT NULL,
  priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P1','P2','P3')),
  subsystem_a_id TEXT REFERENCES subsystems(id),
  subsystem_b_id TEXT REFERENCES subsystems(id),
  -- Resolved part rows once both sides are identified...
  part_a_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  part_b_id TEXT REFERENCES parts(id) ON DELETE SET NULL,
  -- ...and the raw sheet refs, kept so an unresolved side is still visible.
  part_a_ref TEXT,
  part_b_ref TEXT,
  description TEXT,
  driver TEXT,                              -- rule / SES / freeze reason
  owner_user_id TEXT REFERENCES users(id),
  owner_name TEXT,                          -- unresolved owner text from the sheet
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_WORK','AGREED','CLOSED')),
  notes TEXT,
  links TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_interfaces_priority ON interfaces(priority, status);
CREATE INDEX IF NOT EXISTS idx_interfaces_part_a ON interfaces(part_a_id);
CREATE INDEX IF NOT EXISTS idx_interfaces_part_b ON interfaces(part_b_id);

CREATE INDEX IF NOT EXISTS idx_parts_subsystem ON parts(subsystem_id);
CREATE INDEX IF NOT EXISTS idx_parts_design_status ON parts(design_status);
CREATE INDEX IF NOT EXISTS idx_parts_status ON parts(status);
CREATE INDEX IF NOT EXISTS idx_parts_purchase_status ON parts(purchase_status);
CREATE INDEX IF NOT EXISTS idx_parts_importance ON parts(importance);
CREATE INDEX IF NOT EXISTS idx_docs_subsystem ON documents(subsystem_id);
CREATE INDEX IF NOT EXISTS idx_docs_part ON documents(part_id);
CREATE INDEX IF NOT EXISTS idx_docs_task ON documents(task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_subsystem ON tasks(subsystem_id);
CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_calendar_deadline ON calendar_events(deadline_date);
