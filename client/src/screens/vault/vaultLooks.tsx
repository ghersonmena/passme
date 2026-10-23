import {
  Baby,
  Briefcase,
  Building2,
  Car,
  Cloud,
  Code,
  Gamepad2,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  House,
  Landmark,
  Lock,
  Music,
  PawPrint,
  Plane,
  Server,
  Shield,
  ShoppingCart,
  Smartphone,
  Star,
  Users,
  Vault,
  type LucideIcon
} from 'lucide-react'
import type { VaultMeta } from '../../crypto/keys'

// Íconos y colores fijos para las bóvedas. Se guarda solo el id, dentro de los datos cifrados.
export const VAULT_ICONS: Record<string, LucideIcon> = {
  home: House,
  vault: Vault,
  briefcase: Briefcase,
  building: Building2,
  users: Users,
  heart: Heart,
  baby: Baby,
  pet: PawPrint,
  bank: Landmark,
  shopping: ShoppingCart,
  gift: Gift,
  server: Server,
  code: Code,
  cloud: Cloud,
  globe: Globe,
  phone: Smartphone,
  shield: Shield,
  lock: Lock,
  star: Star,
  school: GraduationCap,
  game: Gamepad2,
  music: Music,
  travel: Plane,
  car: Car
}

export const VAULT_COLORS = ['plum', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'slate'] as const

export function VaultIcon({ meta, size = 18 }: { meta: VaultMeta; size?: number }) {
  const Icon = VAULT_ICONS[meta.icon ?? ''] ?? House
  const color = VAULT_COLORS.includes(meta.color as never) ? meta.color : 'plum'
  return (
    <span className={`vault-icon vc-${color}`} aria-hidden>
      <Icon size={size} />
    </span>
  )
}
