-- CreateTable
CREATE TABLE `Purchase` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `chargeId` VARCHAR(191) NOT NULL,
    `kind` ENUM('CREDITS', 'SUBSCRIPTION') NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'DECLINED', 'EXPIRED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `packageId` VARCHAR(191) NULL,
    `planId` VARCHAR(191) NULL,
    `credits` INTEGER NOT NULL DEFAULT 0,
    `amount` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `test` BOOLEAN NOT NULL DEFAULT false,
    `creditedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Purchase_chargeId_key`(`chargeId`),
    INDEX `Purchase_shop_createdAt_idx`(`shop`, `createdAt`),
    INDEX `Purchase_shop_status_idx`(`shop`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

