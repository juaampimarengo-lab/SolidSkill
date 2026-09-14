import type { ComponentType, JSX } from 'react'
import {
  LayoutGrid,
  BookText,
  CalendarDays,
  ListChecks,
  BarChart3,
  ClipboardCheck,
  Wallet,
  Plug,
  Settings
} from 'lucide-react'
import styles from './Sidebar.module.css'

interface NavItem {
  label: string
  icon: ComponentType<{ size?: number; strokeWidth?: number }>
}

const primaryNav: NavItem[] = [
  { label: 'Dashboard', icon: LayoutGrid },
  { label: 'Journal', icon: BookText },
  { label: 'Calendar', icon: CalendarDays },
  { label: 'Strategies', icon: ListChecks },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Weekly Review', icon: ClipboardCheck },
  { label: 'Accounts', icon: Wallet }
]

const utilityNav: NavItem[] = [
  { label: 'Integrations', icon: Plug },
  { label: 'Settings', icon: Settings }
]

interface SidebarProps {
  active: string
  onSelect: (label: string) => void
}

export function Sidebar({ active, onSelect }: SidebarProps): JSX.Element {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark}>S</span>
        <span className={styles.brandName}>Solid Skill</span>
      </div>

      <nav className={styles.nav}>
        {primaryNav.map((item) => (
          <NavRow key={item.label} item={item} active={active === item.label} onSelect={onSelect} />
        ))}
      </nav>

      <nav className={styles.navUtility}>
        {utilityNav.map((item) => (
          <NavRow key={item.label} item={item} active={active === item.label} onSelect={onSelect} />
        ))}
      </nav>
    </aside>
  )
}

function NavRow({
  item,
  active,
  onSelect
}: {
  item: NavItem
  active: boolean
  onSelect: (label: string) => void
}): JSX.Element {
  const Icon = item.icon
  return (
    <button
      type="button"
      className={active ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
      onClick={() => onSelect(item.label)}
    >
      {active && <span className={styles.activeIndicator} />}
      <Icon size={16} strokeWidth={1.75} />
      <span>{item.label}</span>
    </button>
  )
}
