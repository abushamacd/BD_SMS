-- AlterTable
ALTER TABLE `Gateway` ADD COLUMN `lastBalance` VARCHAR(191) NULL,
    ADD COLUMN `lastBalanceAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `ShopSettings` ADD COLUMN `periodStartedAt` DATETIME(3) NULL,
    ADD COLUMN `periodUsage` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `subscriptionPeriodEnd` DATETIME(3) NULL;

