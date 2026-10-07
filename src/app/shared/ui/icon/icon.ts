import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  LucideArrowDownRight,
  LucideArrowRight,
  LucideBox,
  LucideBoxes,
  LucideBanknote,
  LucideCalendarDays,
  LucideChartNoAxesColumnIncreasing,
  LucideCheck,
  LucideChevronRight,
  LucideCircleCheck,
  LucideCircleDollarSign,
  LucideClock3,
  LucideCreditCard,
  LucideDynamicIcon,
  LucideEye,
  LucideHeart,
  LucideImage,
  LucideLayoutDashboard,
  LucideLeaf,
  LucideLogOut,
  LucideMinus,
  LucideMoon,
  LucidePackage,
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
  LucideTrash2,
  LucideTriangleAlert,
  LucideUpload,
  LucideWallet,
  LucideX,
} from '@lucide/angular';

export type BfIconName =
  | 'dashboard' | 'sales' | 'production' | 'inventory' | 'finance' | 'catalog' | 'settings'
  | 'plus' | 'minus' | 'search' | 'sun' | 'moon' | 'logout' | 'close' | 'trash' | 'image'
  | 'calendar' | 'chart' | 'wallet' | 'clock' | 'tag' | 'box' | 'heart' | 'alert' | 'leaf' | 'product'
  | 'receipt' | 'bag' | 'chevron-right' | 'arrow-right' | 'arrow-down-right' | 'eye' | 'card' | 'check'
  | 'tick' | 'qr-code' | 'banknote' | 'upload';

const ICONS = {
  dashboard: LucideLayoutDashboard,
  sales: LucideShoppingCart,
  production: LucidePackage,
  inventory: LucideBoxes,
  finance: LucideCircleDollarSign,
  catalog: LucideTags,
  settings: LucideSettings,
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
  chart: LucideChartNoAxesColumnIncreasing,
  wallet: LucideWallet,
  clock: LucideClock3,
  tag: LucideTag,
  box: LucideBox,
  heart: LucideHeart,
  alert: LucideTriangleAlert,
  leaf: LucideLeaf,
  product: LucidePackage,
  receipt: LucideReceiptText,
  'qr-code': LucideQrCode,
  banknote: LucideBanknote,
  upload: LucideUpload,
  tick: LucideCheck,
  bag: LucideShoppingBag,
  'chevron-right': LucideChevronRight,
  'arrow-right': LucideArrowRight,
  'arrow-down-right': LucideArrowDownRight,
  eye: LucideEye,
  card: LucideCreditCard,
  check: LucideCircleCheck,
} as const;

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
