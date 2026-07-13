-- CreateTable
CREATE TABLE `ShopSettings` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `creditBalance` INTEGER NOT NULL DEFAULT 0,
    `lowBalanceThreshold` INTEGER NOT NULL DEFAULT 500,
    `autoRechargeEnabled` BOOLEAN NOT NULL DEFAULT false,
    `autoRechargePackage` VARCHAR(191) NULL,
    `senderId` VARCHAR(191) NULL,
    `countryCode` VARCHAR(191) NOT NULL DEFAULT '+880',
    `quietHoursEnabled` BOOLEAN NOT NULL DEFAULT false,
    `quietHoursStart` INTEGER NOT NULL DEFAULT 22,
    `quietHoursEnd` INTEGER NOT NULL DEFAULT 8,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Asia/Dhaka',
    `abandonedCartEnabled` BOOLEAN NOT NULL DEFAULT false,
    `discountEnabled` BOOLEAN NOT NULL DEFAULT false,
    `discountCode` VARCHAR(191) NULL,
    `blockTransactional` BOOLEAN NOT NULL DEFAULT false,
    `gatewayMode` ENUM('DEFAULT', 'PERSONAL') NOT NULL DEFAULT 'DEFAULT',
    `subscriptionPlan` VARCHAR(191) NULL,
    `subscriptionChargeId` VARCHAR(191) NULL,
    `subscriptionActive` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShopSettings_shop_key`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CreditLedger` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `type` ENUM('PURCHASE', 'SEND', 'REFUND', 'ADJUSTMENT', 'BONUS') NOT NULL,
    `amount` INTEGER NOT NULL,
    `balanceAfter` INTEGER NOT NULL,
    `description` TEXT NULL,
    `smsLogId` VARCHAR(191) NULL,
    `campaignId` VARCHAR(191) NULL,
    `chargeId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CreditLedger_shop_createdAt_idx`(`shop`, `createdAt`),
    INDEX `CreditLedger_shop_type_idx`(`shop`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Gateway` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `provider` ENUM('BULKSMSBD', 'MIMSMS', 'SSLWIRELESS', 'GENERIC') NOT NULL DEFAULT 'BULKSMSBD',
    `credentials` TEXT NULL,
    `senderId` VARCHAR(191) NULL,
    `urlTemplate` TEXT NULL,
    `httpMethod` VARCHAR(191) NOT NULL DEFAULT 'GET',
    `lastTestedAt` DATETIME(3) NULL,
    `lastTestOk` BOOLEAN NULL,
    `lastTestError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Gateway_shop_key`(`shop`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `key` ENUM('NEW_ORDER', 'FULFILLMENT', 'SHIPMENT', 'DELIVERY', 'CANCELLED', 'COD_OTP', 'ABANDONED_CART_1', 'ABANDONED_CART_2', 'ABANDONED_CART_3') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `body` TEXT NOT NULL,
    `delayHours` INTEGER NULL,
    `includeDiscount` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MessageTemplate_shop_key_key`(`shop`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SmsLog` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NULL,
    `type` ENUM('NEW_ORDER', 'FULFILLMENT', 'SHIPMENT', 'DELIVERY', 'CANCELLED', 'COD_OTP', 'ABANDONED_CART', 'CAMPAIGN', 'MANUAL', 'TEST') NOT NULL,
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED',
    `body` TEXT NOT NULL,
    `encoding` VARCHAR(191) NOT NULL,
    `parts` INTEGER NOT NULL,
    `credits` INTEGER NOT NULL,
    `provider` ENUM('BULKSMSBD', 'MIMSMS', 'SSLWIRELESS', 'GENERIC') NOT NULL,
    `senderId` VARCHAR(191) NULL,
    `providerMessageId` VARCHAR(191) NULL,
    `errorCode` VARCHAR(191) NULL,
    `errorMessage` TEXT NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `campaignId` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `anonymizedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SmsLog_shop_createdAt_idx`(`shop`, `createdAt`),
    INDEX `SmsLog_shop_status_idx`(`shop`, `status`),
    INDEX `SmsLog_shop_type_idx`(`shop`, `type`),
    INDEX `SmsLog_shop_phone_idx`(`shop`, `phone`),
    INDEX `SmsLog_providerMessageId_idx`(`providerMessageId`),
    INDEX `SmsLog_campaignId_idx`(`campaignId`),
    UNIQUE INDEX `SmsLog_shop_dedupeKey_key`(`shop`, `dedupeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Job` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `type` ENUM('SEND_SMS', 'SEND_CAMPAIGN', 'ABANDONED_CART_FOLLOWUP', 'COD_OTP_EXPIRE', 'AUTO_RECHARGE', 'RETENTION_PURGE') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `payload` JSON NOT NULL,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `lastError` TEXT NULL,
    `lockedAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(191) NULL,
    `dedupeKey` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `completedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Job_dedupeKey_key`(`dedupeKey`),
    INDEX `Job_status_runAt_priority_idx`(`status`, `runAt`, `priority`),
    INDEX `Job_shop_type_idx`(`shop`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Campaign` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `body` TEXT NOT NULL,
    `segment` JSON NOT NULL,
    `recipientCount` INTEGER NOT NULL DEFAULT 0,
    `sentCount` INTEGER NOT NULL DEFAULT 0,
    `deliveredCount` INTEGER NOT NULL DEFAULT 0,
    `failedCount` INTEGER NOT NULL DEFAULT 0,
    `creditsUsed` INTEGER NOT NULL DEFAULT 0,
    `scheduledFor` DATETIME(3) NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Campaign_shop_status_idx`(`shop`, `status`),
    INDEX `Campaign_shop_createdAt_idx`(`shop`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CampaignRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `campaignId` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `customerName` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NULL,
    `status` ENUM('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'QUEUED',
    `smsLogId` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CampaignRecipient_campaignId_status_idx`(`campaignId`, `status`),
    UNIQUE INDEX `CampaignRecipient_campaignId_phone_key`(`campaignId`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AbandonedCheckout` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `checkoutToken` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NULL,
    `customerId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `cartValue` DECIMAL(12, 2) NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'BDT',
    `recoveryUrl` TEXT NOT NULL,
    `smsConsent` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('WAITING', 'SENT', 'RECOVERED', 'EXPIRED', 'SKIPPED') NOT NULL DEFAULT 'WAITING',
    `followUpsSent` INTEGER NOT NULL DEFAULT 0,
    `lastFollowUpAt` DATETIME(3) NULL,
    `abandonedAt` DATETIME(3) NOT NULL,
    `recoveredAt` DATETIME(3) NULL,
    `orderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AbandonedCheckout_shop_status_idx`(`shop`, `status`),
    INDEX `AbandonedCheckout_shop_abandonedAt_idx`(`shop`, `abandonedAt`),
    UNIQUE INDEX `AbandonedCheckout_shop_checkoutToken_key`(`shop`, `checkoutToken`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CodOtp` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `expiresAt` DATETIME(3) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CodOtp_shop_status_idx`(`shop`, `status`),
    UNIQUE INDEX `CodOtp_shop_orderId_key`(`shop`, `orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Blacklist` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NULL,
    `source` ENUM('STOP', 'MANUAL', 'DND', 'BOUNCED') NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Blacklist_shop_source_idx`(`shop`, `source`),
    UNIQUE INDEX `Blacklist_shop_phone_key`(`shop`, `phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProcessedWebhook` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `topic` VARCHAR(191) NOT NULL,
    `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProcessedWebhook_processedAt_idx`(`processedAt`),
    INDEX `ProcessedWebhook_shop_topic_idx`(`shop`, `topic`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `SmsLog` ADD CONSTRAINT `SmsLog_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CampaignRecipient` ADD CONSTRAINT `CampaignRecipient_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
