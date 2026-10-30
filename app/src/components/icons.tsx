import type { SVGProps } from "react";

/**
 * Hand-rolled icon set in the Lucide drawing style (24px grid, 1.75 stroke,
 * round caps). A local-first install should not pull an icon package just for
 * twenty glyphs, and inline SVG keeps the bundle offline and server-safe.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 22, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M3.5 10.5 12 3.8l8.5 6.7" />
    <path d="M5.5 9.8V19a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V9.8" />
    <path d="M9.75 20.5v-5.25h4.5v5.25" />
  </Icon>
);

export const ChildIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="7" r="3.25" />
    <path d="M5.5 20.5c0-3.4 2.9-6.1 6.5-6.1s6.5 2.7 6.5 6.1" />
    <path d="M9.5 6.2c.9.7 2 1.1 3.2 1.1.9 0 1.7-.2 2.4-.6" />
  </Icon>
);

export const GuardianIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="8.5" cy="7.5" r="2.75" />
    <circle cx="16.5" cy="9" r="2.25" />
    <path d="M3.5 20.5c0-2.9 2.2-5.2 5-5.2s5 2.3 5 5.2" />
    <path d="M14.5 20.5c0-2.3 1.1-4.1 3-4.6 1.9.5 3 2.3 3 4.6" />
  </Icon>
);

export const ResultIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V5A1.5 1.5 0 0 1 8 3.5Z" />
    <path d="M9.75 8.25h4.5M9.75 12h4.5M9.75 15.75h2.75" />
  </Icon>
);

export const MenuIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="6" cy="6" r="1.6" />
    <circle cx="12" cy="6" r="1.6" />
    <circle cx="18" cy="6" r="1.6" />
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
    <circle cx="6" cy="18" r="1.6" />
    <circle cx="12" cy="18" r="1.6" />
    <circle cx="18" cy="18" r="1.6" />
  </Icon>
);

export const InstrumentIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z" />
    <path d="M11 4h7.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H11" />
    <path d="M14 11.5l1.75 1.75L19 10" />
  </Icon>
);

export const StaffIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="10" cy="8" r="3.25" />
    <path d="M4 20.5c0-3.2 2.7-5.8 6-5.8 1.1 0 2.1.3 3 .8" />
    <circle cx="17.5" cy="17" r="2.5" />
    <path d="M17.5 12.75v1.25M17.5 20v1.25M21 17h-1.25M15.25 17H14" />
  </Icon>
);

export const BuildingIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5.5 20.5V5.2a1.2 1.2 0 0 1 1.2-1.2h7.6a1.2 1.2 0 0 1 1.2 1.2v15.3" />
    <path d="M15.5 10h2.8a1.2 1.2 0 0 1 1.2 1.2v9.3" />
    <path d="M4 20.5h16" />
    <path d="M8.75 8h3.5M8.75 11.5h3.5M8.75 15h3.5" />
  </Icon>
);

export const SparkIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6Z" />
    <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7Z" />
  </Icon>
);

export const ChatIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M20.5 11.5c0 3.9-3.8 7.1-8.5 7.1-.9 0-1.8-.1-2.6-.3l-4.9 2.2 1.3-3.3C4.3 15.9 3.5 13.8 3.5 11.5c0-3.9 3.8-7.1 8.5-7.1s8.5 3.2 8.5 7.1Z" />
    <path d="M8.75 11.5h.01M12 11.5h.01M15.25 11.5h.01" />
  </Icon>
);

export const AuditIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 3.5l7 2.4v5.3c0 4.2-2.8 7.6-7 9.3-4.2-1.7-7-5.1-7-9.3V5.9Z" />
    <path d="M9.25 12.2l1.9 1.9 3.6-3.9" />
  </Icon>
);

export const LogoutIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M10.5 4.5H7A1.5 1.5 0 0 0 5.5 6v12A1.5 1.5 0 0 0 7 19.5h3.5" />
    <path d="M14.5 8.5 18.5 12l-4 3.5" />
    <path d="M18 12h-7.5" />
  </Icon>
);

export const ChevronRightIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Icon>
);

export const ArrowLeftIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M19 12H5.5" />
    <path d="M11 5.5 4.5 12l6.5 6.5" />
  </Icon>
);

export const PlusIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 5.5v13M5.5 12h13" />
  </Icon>
);

export const PrinterIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M7.5 9V4.5h9V9" />
    <path d="M6 9h12a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 18 17h-1.5v2.5h-9V17H6a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 6 9Z" />
    <path d="M9 13.5h6" />
  </Icon>
);

export const SearchIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="11" cy="11" r="6.25" />
    <path d="M15.75 15.75 20 20" />
  </Icon>
);

export const CloseIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Icon>
);

export const CheckIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const AlertIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M12 4.5 20.5 19H3.5Z" />
    <path d="M12 10v4" />
    <path d="M12 16.75h.01" />
  </Icon>
);

export const InfoIcon = (props: IconProps) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.25" />
    <path d="M12 7.9h.01" />
  </Icon>
);

export const CycleIcon = (props: IconProps) => (
  <Icon {...props}>
    <path d="M4.5 12a7.5 7.5 0 0 1 12.8-5.3L19.5 9" />
    <path d="M19.5 4.5V9h-4.5" />
    <path d="M19.5 12a7.5 7.5 0 0 1-12.8 5.3L4.5 15" />
    <path d="M4.5 19.5V15H9" />
  </Icon>
);

export const DeviceIcon = (props: IconProps) => (
  <Icon {...props}>
    <rect x="7" y="3.5" width="10" height="17" rx="2.2" />
    <path d="M10.75 17.5h2.5" />
  </Icon>
);
