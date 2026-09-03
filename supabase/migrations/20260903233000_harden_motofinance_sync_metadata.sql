alter table public.motofinance_state
add column sync_meta jsonb not null default '{"schema":2,"top":{},"collections":{}}'::jsonb;

alter table public.motofinance_state
add constraint motofinance_state_data_object
check (jsonb_typeof(data) = 'object'),
add constraint motofinance_state_data_size
check (octet_length(data::text) <= 2097152),
add constraint motofinance_state_data_shape
check (
  data ?& array['version','profile','vehicles','transactions','reminders','odometerLogs','preferences']
  and jsonb_typeof(data -> 'profile') = 'object'
  and jsonb_typeof(data -> 'vehicles') = 'array'
  and jsonb_typeof(data -> 'transactions') = 'array'
  and jsonb_typeof(data -> 'reminders') = 'array'
  and jsonb_typeof(data -> 'odometerLogs') = 'array'
  and jsonb_typeof(data -> 'preferences') = 'object'
),
add constraint motofinance_state_sync_meta_object
check (jsonb_typeof(sync_meta) = 'object'),
add constraint motofinance_state_sync_meta_size
check (octet_length(sync_meta::text) <= 524288);
