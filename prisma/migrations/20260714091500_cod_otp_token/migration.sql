-- AlterTable
ALTER TABLE `CodOtp` ADD COLUMN `orderTotal` VARCHAR(191) NULL,
    ADD COLUMN `token` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `CodOtp_token_key` ON `CodOtp`(`token`);

