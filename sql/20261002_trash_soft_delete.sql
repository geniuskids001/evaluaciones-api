-- Genius Quiz · papelera global + soft delete de versiones/respuestas
-- IMPORTANTE: revisar y ejecutar manualmente en evaluations_app_bd.
-- Este archivo NO se ejecuta automáticamente desde la aplicación.

ALTER TABLE evaluaciones_versiones
  ADD COLUMN deleted_at DATETIME NULL AFTER published_at,
  ADD COLUMN deleted_by BIGINT UNSIGNED NULL AFTER deleted_at,
  ADD KEY idx_versiones_evaluacion_deleted (id_evaluacion, deleted_at),
  ADD KEY idx_versiones_deleted_by (deleted_by),
  ADD CONSTRAINT fk_versiones_deleted_by
    FOREIGN KEY (deleted_by) REFERENCES usuarios(id_usuario)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE respuestas
  ADD COLUMN deleted_at DATETIME NULL AFTER updated_at,
  ADD COLUMN deleted_by BIGINT UNSIGNED NULL AFTER deleted_at,
  ADD KEY idx_respuestas_aplicacion_deleted (id_aplicacion, deleted_at),
  ADD KEY idx_respuestas_deleted_by (deleted_by),
  ADD CONSTRAINT fk_respuestas_deleted_by
    FOREIGN KEY (deleted_by) REFERENCES usuarios(id_usuario)
    ON DELETE SET NULL ON UPDATE CASCADE;
