create table if not exists notes (id text not null primary key, body text not null, created_at timestamptz default now() not null);
