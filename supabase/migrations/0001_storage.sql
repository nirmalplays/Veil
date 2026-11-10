-- Two buckets. "blobs" is private: nobody can read or write it except through the blob-gate function (service role).
-- "rounds" is public read so anyone can fetch a round manifest and check inclusion; writes still go through the gate.
-- No storage policies are created on purpose: with RLS on and no policy, the anon key can do nothing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('blobs',  'blobs',  false, 5242880, null),
  ('rounds', 'rounds', true,  1048576, array['application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;
