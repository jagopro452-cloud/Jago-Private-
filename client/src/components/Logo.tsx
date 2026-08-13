import React from 'react';

export type LogoVariant = 'blue' | 'white' | 'default' | 'pilot';
export type LogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

const SIZE_MAP: Record<LogoSize, number> = {
  xs: 16,
  sm: 24,
  md: 36,
  lg: 42,
  xl: 56,
  xxl: 84,
};

interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  height?: number; // For custom overrides
  className?: string;
  cardHeight?: number; // Optional: if provided, wraps in card container
  withTag?: boolean; // Show "Admin Console" tag
  withBg?: boolean; // Show background
  style?: React.CSSProperties;
}

export function Logo({
  variant = 'default',
  size = 'md',
  height,
  className = '',
  cardHeight,
  withTag = false,
  withBg = false,
  style = {},
}: LogoProps) {
  const logoMap: Record<LogoVariant, string> = {
    blue: '/jago-logo-new.png',
    white: '/jago-logo-new.png',
    default: '/jago-logo-new.png',
    pilot: '/pilot-logo.png',
  };

  const actualHeight = height || SIZE_MAP[size];
  const src = logoMap[variant];

  const imgElement = (
    <img
      src={src}
      alt="JAGO"
      className={`jl-logo-img ${className}`}
      style={{
        height: actualHeight,
        width: 'auto',
        objectFit: 'contain',
        display: 'block',
        ...style,
      }}
    />
  );

  // If cardHeight specified, wrap in card
  if (cardHeight) {
    return (
      <div
        className="jl-logo-img-card"
        style={{
          background: withBg ? '#ffffff' : 'transparent',
          borderRadius: 16,
          padding: '12px 24px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: withBg ? '0 8px 32px rgba(0,0,0,0.25)' : 'none',
          height: cardHeight,
        }}
      >
        {imgElement}
      </div>
    );
  }

  // If tag needed, wrap in tag container
  if (withTag) {
    return (
      <div className="jl-logo-wrap">
        <div className="jl-logo-img-card">
          {imgElement}
        </div>
        <span className="jl-logo-tag">Admin Console</span>
      </div>
    );
  }

  return imgElement;
}

export function LogoGroup({
  variant = 'default',
  size = 'md',
  textLabel,
  children,
  style,
}: {
  variant?: LogoVariant;
  size?: LogoSize;
  textLabel?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        ...style,
      }}
    >
      <Logo variant={variant} size={size} />
      {textLabel && <span>{textLabel}</span>}
      {children}
    </div>
  );
}
