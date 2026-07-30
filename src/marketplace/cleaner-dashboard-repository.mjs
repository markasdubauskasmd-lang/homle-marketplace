function documentRecord(row) {
  if (!row) return null;
  return Object.freeze({
    documentId: row.id,
    documentType: row.document_type,
    originalFileName: row.original_file_name,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    checksumSha256: row.checksum_hex,
    status: row.status,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at || null,
    uploadExpiresAt: row.upload_expires_at instanceof Date ? row.upload_expires_at.toISOString() : row.upload_expires_at,
    uploadedAt: row.uploaded_at instanceof Date ? row.uploaded_at.toISOString() : row.uploaded_at || null,
    verifiedAt: row.verified_at instanceof Date ? row.verified_at.toISOString() : row.verified_at || null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  });
}

const documentColumns = "id,document_type,original_file_name,storage_key,mime_type,byte_size,encode(checksum_sha256,'hex') AS checksum_hex,status,expires_at,upload_expires_at,uploaded_at,verified_at,created_at,updated_at";

export function createCleanerDashboardRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  const transact = (actor, operation) => database.withUserTransaction(actor, operation);
  return Object.freeze({
    getSection(actor, sectionCode) {
      return transact(actor, async (client) => {
        const row = (await client.query(
          "SELECT section_code,payload,completion_status,updated_at FROM cleaner_onboarding_sections WHERE cleaner_user_id=$1::uuid AND section_code=$2::text",
          [actor.userId, sectionCode]
        )).rows[0];
        return row ? { sectionCode: row.section_code, payload: row.payload, completionStatus: row.completion_status, updatedAt: row.updated_at } : null;
      });
    },
    saveSection(actor, record) {
      return transact(actor, async (client) => {
        const row = (await client.query(
          `INSERT INTO cleaner_onboarding_sections (cleaner_user_id,section_code,payload,completion_status)
           VALUES ($1::uuid,$2::text,$3::jsonb,$4::text)
           ON CONFLICT (cleaner_user_id,section_code) DO UPDATE
           SET payload=EXCLUDED.payload,completion_status=EXCLUDED.completion_status,updated_at=now()
           RETURNING section_code,payload,completion_status,updated_at`,
          [actor.userId, record.sectionCode, record.payload, record.completionStatus]
        )).rows[0];
        return { sectionCode: row.section_code, payload: row.payload, completionStatus: row.completion_status, updatedAt: row.updated_at };
      });
    },
    listDocuments(actor) {
      return transact(actor, async (client) => (await client.query(
        `SELECT ${documentColumns} FROM cleaner_documents WHERE cleaner_user_id=$1::uuid ORDER BY created_at DESC LIMIT 100`,
        [actor.userId]
      )).rows.map(documentRecord));
    },
    createDocumentIntent(actor, input) {
      return transact(actor, async (client) => documentRecord((await client.query(
        `INSERT INTO cleaner_documents (id,cleaner_user_id,document_type,original_file_name,storage_key,mime_type,byte_size,checksum_sha256,upload_expires_at)
         VALUES ($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::integer,decode($8::text,'hex'),$9::timestamptz)
         RETURNING ${documentColumns}`,
        [input.documentId, actor.userId, input.documentType, input.originalFileName, input.storageKey, input.mimeType, input.byteSize, input.checksumSha256, input.uploadExpiresAt]
      )).rows[0]));
    },
    getDocument(actor, documentId) {
      return transact(actor, async (client) => documentRecord((await client.query(
        `SELECT ${documentColumns} FROM cleaner_documents WHERE id=$1::uuid AND cleaner_user_id=$2::uuid`,
        [documentId, actor.userId]
      )).rows[0]));
    },
    completeDocument(actor, documentId) {
      return transact(actor, async (client) => documentRecord((await client.query(
        `UPDATE cleaner_documents SET status='pending-review',uploaded_at=now(),updated_at=now()
         WHERE id=$1::uuid AND cleaner_user_id=$2::uuid AND status='uploading' AND upload_expires_at>now()
         RETURNING ${documentColumns}`,
        [documentId, actor.userId]
      )).rows[0]));
    },
    listTraining(actor) {
      return transact(actor, async (client) => (await client.query(
        "SELECT module_code,status,completed_lessons,total_lessons,started_at,completed_at,updated_at FROM cleaner_training_progress WHERE cleaner_user_id=$1::uuid ORDER BY module_code",
        [actor.userId]
      )).rows);
    },
    saveTraining(actor, input) {
      return transact(actor, async (client) => (await client.query(
        `INSERT INTO cleaner_training_progress (cleaner_user_id,module_code,status,completed_lessons,total_lessons,started_at,completed_at)
         VALUES ($1::uuid,$2::text,$3::text,$4::smallint,$5::smallint,$6::timestamptz,$7::timestamptz)
         ON CONFLICT (cleaner_user_id,module_code) DO UPDATE
         SET status=EXCLUDED.status,completed_lessons=EXCLUDED.completed_lessons,total_lessons=EXCLUDED.total_lessons,
             started_at=COALESCE(cleaner_training_progress.started_at,EXCLUDED.started_at),
             completed_at=EXCLUDED.completed_at,updated_at=now()
         RETURNING module_code,status,completed_lessons,total_lessons,started_at,completed_at,updated_at`,
        [actor.userId, input.moduleCode, input.status, input.completedLessons, input.totalLessons, input.startedAt, input.completedAt]
      )).rows[0]);
    },
    listAgreements(actor) {
      return transact(actor, async (client) => (await client.query(
        "SELECT agreement_code,policy_version,signed_name,signed_at FROM cleaner_agreement_signatures WHERE cleaner_user_id=$1::uuid ORDER BY agreement_code",
        [actor.userId]
      )).rows);
    },
    signAgreement(actor, input) {
      return transact(actor, async (client) => (await client.query(
        `INSERT INTO cleaner_agreement_signatures (cleaner_user_id,agreement_code,policy_version,signed_name)
         VALUES ($1::uuid,$2::text,$3::text,$4::text)
         ON CONFLICT (cleaner_user_id,agreement_code,policy_version) DO NOTHING
         RETURNING agreement_code,policy_version,signed_name,signed_at`,
        [actor.userId, input.agreementCode, input.policyVersion, input.signedName]
      )).rows[0] || null);
    }
  });
}
