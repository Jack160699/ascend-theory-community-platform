export type ModuleStatus = "active" | "beta" | "planned" | "maintenance";

export type AdminSubModule = {
  id: string;
  title: string;
  href: string;
  description: string;
  status: ModuleStatus;
  badge?: string;
  minRole?: "owner" | "admin" | "editor" | "support";
};

export type AdminDomainSection = {
  id: string;
  title: string;
  iconName: string;
  badge?: string;
  modules: AdminSubModule[];
};

export const ADMIN_DOMAINS: AdminDomainSection[] = [
  {
    id: "overview",
    title: "Overview",
    iconName: "LayoutDashboard",
    modules: [
      {
        id: "dashboard",
        title: "Dashboard",
        href: "/admin",
        description: "Unified platform control center, metrics overview, and quick operations.",
        status: "active",
      },
      {
        id: "activity",
        title: "Activity",
        href: "/admin/overview/activity",
        description: "Real-time stream of platform events, orders, user signups, and system alerts.",
        status: "active",
        badge: "Live",
      },
      {
        id: "notifications",
        title: "Notifications",
        href: "/admin/overview/notifications",
        description: "System notifications, low stock warnings, and fulfillment status updates.",
        status: "active",
        badge: "3 New",
      },
    ],
  },
  {
    id: "website",
    title: "Website",
    iconName: "Globe",
    modules: [
      {
        id: "homepage",
        title: "Homepage",
        href: "/admin/website/homepage",
        description: "Manage homepage portals, cinematic video hero settings, and main CTA stack.",
        status: "active",
      },
      {
        id: "pages",
        title: "Pages",
        href: "/admin/website/pages",
        description: "CMS for static and dynamic pages (Philosophy, Terms, Privacy, Refunds).",
        status: "beta",
      },
      {
        id: "navigation",
        title: "Navigation",
        href: "/admin/website/navigation",
        description: "Global brand header, footer links, and internal exploration routes.",
        status: "active",
      },
      {
        id: "sections",
        title: "Sections",
        href: "/admin/website/sections",
        description: "Manage hero blocks, atmospheric visual rails, and narrative scroll scenes.",
        status: "planned",
      },
      {
        id: "media",
        title: "Media",
        href: "/admin/website/media",
        description: "Digital asset library, video optimization, and stock photography manager.",
        status: "active",
      },
    ],
  },
  {
    id: "journal",
    title: "Journal",
    iconName: "BookOpen",
    modules: [
      {
        id: "articles",
        title: "Articles",
        href: "/admin/journal/articles",
        description: "Editorial engine — draft, schedule, and publish luxury journal articles.",
        status: "active",
        badge: "12 Published",
      },
      {
        id: "authors",
        title: "Authors",
        href: "/admin/journal/authors",
        description: "Contributor profiles, editorial signatures, and bio management.",
        status: "active",
      },
      {
        id: "categories",
        title: "Categories",
        href: "/admin/journal/categories",
        description: "Editorial taxonomy (Discipline, Mindset, Design, Craft, Culture).",
        status: "active",
      },
      {
        id: "seo",
        title: "SEO",
        href: "/admin/journal/seo",
        description: "OpenGraph metadata, structured data schema (Article / JSON-LD), and indexation.",
        status: "beta",
      },
    ],
  },
  {
    id: "community",
    title: "Community",
    iconName: "Users",
    modules: [
      {
        id: "members",
        title: "Members",
        href: "/admin/community/members",
        description: "Directory of registered members, engagement scores, and account status.",
        status: "active",
        badge: "2,480",
      },
      {
        id: "posts",
        title: "Posts",
        href: "/admin/community/posts",
        description: "Member-generated discussions, theory posts, and commentary moderation.",
        status: "beta",
      },
      {
        id: "groups",
        title: "Groups",
        href: "/admin/community/groups",
        description: "Private theory circles, mastermind spaces, and invite-only channels.",
        status: "planned",
      },
      {
        id: "moderation",
        title: "Moderation",
        href: "/admin/community/moderation",
        description: "Flagged content queue, community guideline enforcement, and automated safety filters.",
        status: "active",
      },
    ],
  },
  {
    id: "membership",
    title: "Membership",
    iconName: "Crown",
    modules: [
      {
        id: "plans",
        title: "Plans",
        href: "/admin/membership/plans",
        description: "Tiered access plans (Initiate, Inner Circle, Ascendant, Apex Sovereign).",
        status: "active",
      },
      {
        id: "subscribers",
        title: "Subscribers",
        href: "/admin/membership/subscribers",
        description: "Active subscription management, renewal dates, and churn indicators.",
        status: "active",
      },
      {
        id: "benefits",
        title: "Benefits",
        href: "/admin/membership/benefits",
        description: "Exclusive drop early access, private drops, and digital vault permissions.",
        status: "planned",
      },
      {
        id: "billing",
        title: "Billing",
        href: "/admin/membership/billing",
        description: "Recurring revenue dashboard, failed payment retries, and dunning workflows.",
        status: "beta",
      },
    ],
  },
  {
    id: "wearables",
    title: "Wearables",
    iconName: "Shirt",
    modules: [
      {
        id: "products",
        title: "Products",
        href: "/admin/wearables/products",
        description: "Master catalog of physical garments, materials, pricing, and specs.",
        status: "active",
      },
      {
        id: "drops",
        title: "Drops",
        href: "/admin/wearables/drops",
        description: "Limited release drop scheduler, countdown orchestrator, and drop status.",
        status: "active",
        badge: "Drop 01 Live",
      },
      {
        id: "collections",
        title: "Collections",
        href: "/admin/wearables/collections",
        description: "Seasonal groupings, capsule collections, and aesthetic themes.",
        status: "active",
      },
      {
        id: "design-studio",
        title: "Design Studio",
        href: "/admin/wearables/design-studio",
        description: "Artwork assets, garment placements, physical mm specs, visual overlay preview, and mockup manager.",
        status: "active",
        badge: "Internal",
      },
      {
        id: "pod-mapping",
        title: "POD Mapping",
        href: "/admin/wearables/pod-mapping",
        description: "Map Ascend garments & exact variants to Qikink/Printrove provider SKUs and readiness matrix.",
        status: "active",
        badge: "Provider",
      },
      {
        id: "variants",
        title: "Variants",
        href: "/admin/wearables/variants",
        description: "Size & color inventory matrices, stock keeping units (SKUs).",
        status: "active",
      },
      {
        id: "size-charts",
        title: "Size Charts",
        href: "/admin/wearables/size-charts",
        description: "Fit guides, garment measurement matrices, and recommendation sizing parameters.",
        status: "active",
      },
    ],
  },
  {
    id: "commerce",
    title: "Commerce",
    iconName: "ShoppingBag",
    modules: [
      {
        id: "orders",
        title: "Orders",
        href: "/admin/commerce/orders",
        description: "Master order management, payment statuses, and customer purchase histories.",
        status: "active",
      },
      {
        id: "customers",
        title: "Customers",
        href: "/admin/commerce/customers",
        description: "Customer LTV, order frequency, shipping addresses, and support logs.",
        status: "active",
      },
      {
        id: "payments",
        title: "Payments",
        href: "/admin/commerce/payments",
        description: "Razorpay transaction logs, webhook health, and currency conversions.",
        status: "active",
      },
      {
        id: "refunds",
        title: "Refunds",
        href: "/admin/commerce/refunds",
        description: "Refund requests, processing queue, and return reason analytics.",
        status: "active",
      },
      {
        id: "discounts",
        title: "Discounts",
        href: "/admin/commerce/discounts",
        description: "Promo codes, VIP member discounts, and automatic checkout rules.",
        status: "beta",
      },
      {
        id: "cod",
        title: "Cash on Delivery",
        href: "/admin/commerce/cod",
        description: "COD risk decisions, OTP verification queue, advance payments, and RTO risk profile management.",
        status: "active",
        badge: "Risk HQ",
      },
    ],
  },
  {
    id: "fulfilment",
    title: "Fulfilment",
    iconName: "Truck",
    modules: [
      {
        id: "providers",
        title: "Providers",
        href: "/admin/fulfilment/providers",
        description: "Fulfillment partner configuration and routing priority matrix.",
        status: "active",
      },
      {
        id: "qikink",
        title: "Qikink",
        href: "/admin/fulfilment/qikink",
        description: "Qikink API status, print order syncing, and mock sample queue.",
        status: "planned",
        badge: "Abstraction",
      },
      {
        id: "printrove",
        title: "Printrove",
        href: "/admin/fulfilment/printrove",
        description: "Printrove POD connection status, inventory sync, and error logs.",
        status: "planned",
        badge: "Abstraction",
      },
      {
        id: "shipments",
        title: "Shipments",
        href: "/admin/fulfilment/shipments",
        description: "Active dispatch queue, waybills, and packaging manifests.",
        status: "active",
      },
      {
        id: "tracking",
        title: "Tracking",
        href: "/admin/fulfilment/tracking",
        description: "Courier API webhooks, delivery milestone tracking, and delay alerts.",
        status: "active",
      },
      {
        id: "returned-inventory",
        title: "Returned Inventory",
        href: "/admin/fulfilment/returned-inventory",
        description: "Inspected returns, restock logs, and damaged item disposition.",
        status: "beta",
      },
      {
        id: "rto",
        title: "RTO",
        href: "/admin/fulfilment/rto",
        description: "Return to Origin tracking, NDR (Non-Delivery Report) action workflows.",
        status: "planned",
      },
    ],
  },
  {
    id: "marketing",
    title: "Marketing",
    iconName: "Megaphone",
    modules: [
      {
        id: "campaigns",
        title: "Campaigns",
        href: "/admin/marketing/campaigns",
        description: "Omnichannel launch campaigns for drops, journal issues, and events.",
        status: "active",
      },
      {
        id: "email",
        title: "Email",
        href: "/admin/marketing/email",
        description: "Editorial newsletter broadcasts, drip automations, and transactional templates.",
        status: "beta",
      },
      {
        id: "whatsapp",
        title: "WhatsApp",
        href: "/admin/marketing/whatsapp",
        description: "VIP WhatsApp notification alerts for drop launches and member updates.",
        status: "beta",
      },
      {
        id: "social",
        title: "Social",
        href: "/admin/marketing/social",
        description: "Social media preview generator, asset export, and content calendar.",
        status: "planned",
      },
      {
        id: "coupons",
        title: "Coupons",
        href: "/admin/marketing/coupons",
        description: "Exclusive member coupon codes, single-use vouchers, and affiliate tracking.",
        status: "active",
      },
    ],
  },
  {
    id: "growth",
    title: "Growth",
    iconName: "TrendingUp",
    modules: [
      {
        id: "analytics",
        title: "Analytics",
        href: "/admin/growth/analytics",
        description: "Meta Pixel & Clarity session telemetry, conversion funnels, and LTV trends.",
        status: "active",
      },
      {
        id: "seo",
        title: "SEO",
        href: "/admin/growth/seo",
        description: "Global meta titles, sitemap status, schema tags, and keyword tracking.",
        status: "active",
      },
      {
        id: "search-performance",
        title: "Search Performance",
        href: "/admin/growth/search-performance",
        description: "Internal search query telemetry, zero-result terms, and click-through rates.",
        status: "beta",
      },
    ],
  },
  {
    id: "system",
    title: "System",
    iconName: "Settings",
    modules: [
      {
        id: "integrations",
        title: "Integrations",
        href: "/admin/system/integrations",
        description: "Status of Stripe, Razorpay, Meta Pixel, Clarity, Qikink, and Email gateways.",
        status: "active",
        badge: "5 Connected",
      },
      {
        id: "api-keys",
        title: "API Keys",
        href: "/admin/system/api-keys",
        description: "Management of webhook secrets, API access tokens, and environment variables.",
        status: "active",
        minRole: "owner",
      },
      {
        id: "users",
        title: "Users",
        href: "/admin/system/users",
        description: "Admin staff accounts, invitation triggers, and access history.",
        status: "active",
        minRole: "admin",
      },
      {
        id: "roles",
        title: "Roles",
        href: "/admin/system/roles",
        description: "Role-Based Access Control (RBAC) definitions: Owner, Admin, Editor, Support.",
        status: "active",
        minRole: "owner",
      },
      {
        id: "audit-logs",
        title: "Audit Logs",
        href: "/admin/system/audit-logs",
        description: "Immutable security trail of staff actions, setting changes, and exports.",
        status: "active",
      },
      {
        id: "settings",
        title: "Settings",
        href: "/admin/system/settings",
        description: "Global Ascend Theory platform parameters, brand variables, and features flags.",
        status: "active",
      },
    ],
  },
];

export function getModuleByPath(pathname: string): {
  domain?: AdminDomainSection;
  module?: AdminSubModule;
} {
  const normalized = pathname.endsWith("/") && pathname !== "/admin" ? pathname.slice(0, -1) : pathname;
  
  for (const domain of ADMIN_DOMAINS) {
    for (const mod of domain.modules) {
      if (mod.href === normalized) {
        return { domain, module: mod };
      }
    }
  }

  // Fallback match by domain prefix
  for (const domain of ADMIN_DOMAINS) {
    if (normalized.startsWith(`/admin/${domain.id}`)) {
      return { domain, module: domain.modules[0] };
    }
  }

  return { domain: ADMIN_DOMAINS[0], module: ADMIN_DOMAINS[0].modules[0] };
}

export function getAllModules(): AdminSubModule[] {
  return ADMIN_DOMAINS.flatMap((domain) => domain.modules);
}
