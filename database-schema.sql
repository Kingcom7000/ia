create table contacts (
  id text primary key,
  email text unique not null,
  company text not null,
  sector text,
  location text,
  website text,
  facebook text,
  linkedin text,
  google_business text,
  main_offer text,
  target_client text,
  commercial_message text,
  main_objective text,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);

create table diagnostics (
  id text primary key,
  contact_id text not null references contacts(id),
  competitor_1 text,
  competitor_2 text,
  competitor_3 text,
  score integer,
  maturity text,
  risk text,
  report_url text,
  report_json text,
  status text not null default 'started',
  created_at timestamp not null default current_timestamp,
  completed_at timestamp
);

create table purchases (
  id text primary key,
  contact_id text not null references contacts(id),
  diagnostic_id text references diagnostics(id),
  product_code text not null,
  product_name text not null,
  amount_cents integer not null,
  currency text not null default 'EUR',
  payment_provider text not null,
  payment_provider_id text unique,
  status text not null,
  created_at timestamp not null default current_timestamp
);

create table commercial_events (
  id text primary key,
  contact_id text references contacts(id),
  diagnostic_id text references diagnostics(id),
  event_name text not null,
  payload_json text,
  brevo_synced_at timestamp,
  created_at timestamp not null default current_timestamp
);

create table calendly_bookings (
  id text primary key,
  contact_id text not null references contacts(id),
  event_uri text unique not null,
  invitee_uri text,
  start_time timestamp,
  end_time timestamp,
  status text not null default 'booked',
  created_at timestamp not null default current_timestamp
);

create table crm_deals (
  id text primary key,
  contact_id text not null references contacts(id),
  brevo_deal_id text,
  stage text not null,
  amount_cents integer,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);

create view admin_metrics as
select
  (select count(*) from commercial_events where event_name = 'CHECKUP_STARTED') as diagnostics_started,
  (select count(*) from commercial_events where event_name = 'CHECKUP_COMPLETED') as diagnostics_completed,
  (select count(*) from purchases where product_code = 'CHECKUP_27' and status = 'paid') as sales_27,
  (select count(*) from purchases where product_code = 'BUMP_17' and status = 'paid') as bumps_17,
  (select count(*) from purchases where product_code = 'UPSELL_97' and status = 'paid') as sales_97,
  (select count(*) from purchases where product_code = 'CALL_297' and status = 'paid') as calls_297,
  (select count(*) from calendly_bookings where status = 'booked') as calendly_bookings,
  (select count(*) from purchases where product_code = 'ACCOMPAGNEMENT' and status = 'active') as accompagnement_clients;

