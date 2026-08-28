<script setup lang="ts">
import { computed } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import {
  brandMediaColor,
  formatBrandMediaCount,
  formatBrandMediaDate,
  formatBrandMediaMoney,
  type BrandMediaPublisherView
} from "./brandMediaModel";

const props = defineProps<{
  publishers: readonly BrandMediaPublisherView[];
  language: UiLanguage;
  emptyMessage: string;
}>();

const copy = computed(() => ({
  media: translateMessage(props.language, "brandMedia.media", "Media"),
  manager: translateMessage(props.language, "brandMedia.manager", "Media manager"),
  revenue: translateMessage(props.language, "brandMedia.revenue", "Revenue"),
  orders: translateMessage(props.language, "brandMedia.orders", "Orders"),
  activeDays: translateMessage(props.language, "brandMedia.activeDays", "Active days"),
  firstSeen: translateMessage(props.language, "brandMedia.firstSeen", "First record"),
  lastSeen: translateMessage(props.language, "brandMedia.lastSeen", "Last record")
}));
</script>

<template>
  <div class="brand-media-table-wrap">
    <table class="brand-media-table">
      <thead>
        <tr>
          <th>{{ copy.media }}</th>
          <th>{{ copy.manager }}</th>
          <th class="brand-media-numeric">{{ copy.revenue }}</th>
          <th class="brand-media-numeric">{{ copy.orders }}</th>
          <th class="brand-media-numeric">{{ copy.activeDays }}</th>
          <th>{{ copy.firstSeen }}</th>
          <th>{{ copy.lastSeen }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!publishers.length">
          <td colspan="7" class="brand-media-empty-cell">{{ emptyMessage }}</td>
        </tr>
        <tr v-for="publisher in publishers" v-else :key="publisher.publisherKey">
          <td>
            <span class="brand-media-table-dot" :style="{ '--brand-media-line': brandMediaColor(publisher.sourceIndex) }" />
            <strong>{{ publisher.userName }}</strong>
            <small>ID {{ publisher.userId }}</small>
          </td>
          <td class="brand-media-manager-cell">{{ publisher.adminName }}</td>
          <td class="brand-media-numeric">{{ formatBrandMediaMoney(publisher.totalRevenue) }}</td>
          <td class="brand-media-numeric">{{ formatBrandMediaCount(publisher.totalOrders) }}</td>
          <td class="brand-media-numeric">{{ formatBrandMediaCount(publisher.activeDays) }}</td>
          <td>{{ formatBrandMediaDate(publisher.firstActiveDate) }}</td>
          <td>{{ formatBrandMediaDate(publisher.lastActiveDate) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
