import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  LucideAlarmClock,
  LucideArrowDownRight,
  LucideArrowRight,
  LucideArrowRightLeft,
  LucideBadgeDollarSign,
  LucideBanknote,
  LucideBookOpen,
  LucideBoxes,
  LucideCalendarDays,
  LucideCalculator,
  LucideChartNoAxesColumnIncreasing,
  LucideCheck,
  LucideChevronRight,
  LucideCircleCheck,
  LucideCircleDollarSign,
  LucideCirclePlus,
  LucideClipboardList,
  LucideClock3,
  LucideCreditCard,
  LucideDynamicIcon,
  LucideEllipsis,
  LucideEye,
  LucideFactory,
  LucideFlaskConical,
  LucideHandCoins,
  LucideImage,
  LucideInfo,
  LucideLayoutDashboard,
  LucideLogOut,
  LucideMinus,
  LucideMoon,
  LucidePackage,
  LucidePackageCheck,
  LucidePackageMinus,
  LucidePackagePlus,
  LucidePackageX,
  LucidePlus,
  LucideQrCode,
  LucideReceiptText,
  LucideSearch,
  LucideSettings,
  LucideShoppingBag,
  LucideShoppingCart,
  LucideSun,
  LucideTag,
  LucideTags,
  LucideTicket,
  LucideTrash2,
  LucideTriangleAlert,
  LucideUpload,
  LucideUserRound,
  LucideWallet,
  LucideWarehouse,
  LucideWrench,
  LucideX,
} from '@lucide/angular';

/**
 * Semantic icon vocabulary for the Bem Feito UI.
 *
 * Domain concepts intentionally have their own names instead of leaking raw
 * glyph names into screens. Reuse generic icons only for truly generic
 * actions/states (search, close, delete, success, etc.).
 */
export type BfIconName =
  // Main navigation
  | 'dashboard' | 'sales' | 'production' | 'inventory' | 'finance' | 'catalog' | 'settings'
  // Commerce and catalog concepts
  | 'product' | 'kit' | 'addition' | 'order' | 'catalog-browse' | 'customer'
  | 'payment' | 'details' | 'confirm-sale'
  // Dashboard and financial concepts
  | 'revenue' | 'received' | 'receivable' | 'average-ticket' | 'sold-items' | 'tips'
  | 'negative-stock' | 'low-stock-product' | 'low-stock-input' | 'overdue' | 'missing-cost'
  | 'cogs' | 'cash-out' | 'cash-flow'
  // Expense concepts
  | 'purchase' | 'expense' | 'equipment' | 'other-expense'
  // Payment methods
  | 'qr-code' | 'banknote' | 'card' | 'receipt' | 'payment-other'
  // Generic actions, media and states
  | 'plus' | 'minus' | 'search' | 'sun' | 'moon' | 'logout' | 'close' | 'trash' | 'image'
  | 'calendar' | 'alert' | 'info' | 'chevron-right' | 'arrow-right' | 'eye' | 'check'
  | 'tick' | 'upload' | 'more';

const ICONS = {
  dashboard: LucideLayoutDashboard,
  sales: LucideShoppingCart,
  production: LucideFactory,
  inventory: LucideWarehouse,
  finance: LucideCircleDollarSign,
  catalog: LucideTags,
  settings: LucideSettings,

  product: LucidePackage,
  kit: LucideBoxes,
  addition: LucideCirclePlus,
  order: LucideShoppingBag,
  'catalog-browse': LucideBookOpen,
  customer: LucideUserRound,
  payment: LucideCreditCard,
  details: LucideClipboardList,
  'confirm-sale': LucideCircleCheck,

  revenue: LucideChartNoAxesColumnIncreasing,
  received: LucideBanknote,
  receivable: LucideClock3,
  'average-ticket': LucideTicket,
  'sold-items': LucidePackageCheck,
  tips: LucideHandCoins,
  'negative-stock': LucidePackageX,
  'low-stock-product': LucidePackageMinus,
  'low-stock-input': LucideFlaskConical,
  overdue: LucideAlarmClock,
  'missing-cost': LucideBadgeDollarSign,
  cogs: LucideCalculator,
  'cash-out': LucideArrowDownRight,
  'cash-flow': LucideArrowRightLeft,

  purchase: LucidePackagePlus,
  expense: LucideReceiptText,
  equipment: LucideWrench,
  'other-expense': LucideTag,

  'qr-code': LucideQrCode,
  banknote: LucideBanknote,
  card: LucideCreditCard,
  receipt: LucideReceiptText,
  'payment-other': LucideWallet,

  plus: LucidePlus,
  minus: LucideMinus,
  search: LucideSearch,
  sun: LucideSun,
  moon: LucideMoon,
  logout: LucideLogOut,
  close: LucideX,
  trash: LucideTrash2,
  image: LucideImage,
  calendar: LucideCalendarDays,
  alert: LucideTriangleAlert,
  info: LucideInfo,
  'chevron-right': LucideChevronRight,
  'arrow-right': LucideArrowRight,
  eye: LucideEye,
  check: LucideCircleCheck,
  tick: LucideCheck,
  upload: LucideUpload,
  more: LucideEllipsis,
} as const satisfies Record<BfIconName, unknown>;

@Component({
  selector: 'bf-icon',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon.html',
  styleUrl: './icon.scss',
})
export class BfIcon {
  readonly name = input.required<BfIconName>();
  readonly icon = computed(() => ICONS[this.name()]);
}
