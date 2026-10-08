-- Reference data every deploy keeps current: an upsert, so running it again
-- changes nothing but what it says.
insert into notes (id, body) values ('welcome', 'Seeded by every deploy')
on conflict (id) do update set body = excluded.body;
