CREATE TABLE IF NOT EXISTS `obra_medicoes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `tipo` enum('pls','rae','marco_30','marco_85','final','repactuacao') NOT NULL DEFAULT 'pls',
  `data_prevista` timestamp NULL,
  `data_recebimento_cef` timestamp NULL,
  `valor_cef` decimal(15,2) NULL,
  `data_transferencia` timestamp NULL,
  `valor_transferido` decimal(15,2) NULL,
  `status` enum('pending','cef_paid','received','contractor_paid') NOT NULL DEFAULT 'pending',
  `empreiteiro` varchar(255) NULL,
  `valor_pago_empreiteiro` decimal(15,2) NULL,
  `notes` text NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_obra_medicoes_project_id` (`project_id`)
);
