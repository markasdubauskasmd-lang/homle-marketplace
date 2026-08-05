BEGIN;

CREATE TABLE cleaner_profile_photos (
  cleaner_user_id uuid PRIMARY KEY REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  image_bytes bytea NOT NULL CHECK (octet_length(image_bytes) BETWEEN 1 AND 1572864),
  mime_type text NOT NULL CHECK (mime_type='image/jpeg'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 1572864 AND byte_size=octet_length(image_bytes)),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 1024),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cleaner_profile_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY cleaner_profile_photos_owner_or_admin ON cleaner_profile_photos
  USING (cleaner_user_id=tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  WITH CHECK (cleaner_user_id=tideway_private.current_user_id() OR tideway_private.has_role('administrator'));

CREATE FUNCTION tideway_private.save_my_cleaner_profile_photo(supplied_bytes bytea,supplied_mime_type text,supplied_byte_size integer,supplied_checksum text,supplied_width integer,supplied_height integer)
RETURNS TABLE(mime_type text,byte_size integer,width integer,height integer,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); saved cleaner_profile_photos%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required'; END IF;
  INSERT INTO cleaner_profile_photos(cleaner_user_id,image_bytes,mime_type,byte_size,checksum_sha256,width,height)
    VALUES(actor_id,supplied_bytes,supplied_mime_type,supplied_byte_size,supplied_checksum,supplied_width,supplied_height)
    ON CONFLICT (cleaner_user_id) DO UPDATE SET image_bytes=EXCLUDED.image_bytes,mime_type=EXCLUDED.mime_type,byte_size=EXCLUDED.byte_size,checksum_sha256=EXCLUDED.checksum_sha256,width=EXCLUDED.width,height=EXCLUDED.height,updated_at=now()
    RETURNING * INTO saved;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'cleaner-profile-photo-saved','cleaner_profile_photo',actor_id::text,jsonb_build_object('byteSize',saved.byte_size,'width',saved.width,'height',saved.height));
  RETURN QUERY SELECT saved.mime_type,saved.byte_size,saved.width,saved.height,saved.updated_at;
END $$;

CREATE FUNCTION tideway_private.get_my_cleaner_profile_photo()
RETURNS TABLE(image_bytes bytea,mime_type text,byte_size integer,width integer,height integer,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required'; END IF;
  RETURN QUERY SELECT photo.image_bytes,photo.mime_type,photo.byte_size,photo.width,photo.height,photo.updated_at
    FROM cleaner_profile_photos photo WHERE photo.cleaner_user_id=actor_id;
END $$;

REVOKE ALL ON TABLE cleaner_profile_photos FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.save_my_cleaner_profile_photo(bytea,text,integer,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_my_cleaner_profile_photo() FROM PUBLIC;

COMMIT;
