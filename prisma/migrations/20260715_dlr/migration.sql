-- AlterTable
ALTER TABLE `CampaignRecipient` MODIFY `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'UNDELIVERED', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED';

-- AlterTable
ALTER TABLE `ShopSettings` ADD COLUMN `dlrToken` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `SmsLog` MODIFY `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'UNDELIVERED', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED';

-- CreateIndex
CREATE UNIQUE INDEX `ShopSettings_dlrToken_key` ON `ShopSettings`(`dlrToken`);

