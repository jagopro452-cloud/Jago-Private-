# JAGO FLUTTER APPS — UNIFIED DESIGN TOKENS
# Senior Designer Standards Applied
# Date: March 24, 2026

## 🎨 CUSTOMER APP — Premium Blue Theme
# File: flutter_apps/customer_app/lib/config/design_tokens.dart

app_name: JAGO
app_variant: customer

# PRIMARY PALETTE
color_primary: #2F6BFF
color_primary_dark: #1F45CC
color_primary_light: #E8F0FF
color_secondary: #5B8FFF

# BACKGROUNDS
color_bg: #FFFFFF
color_bg_soft: #F9FAFB
color_surface: #FFFFFF
color_surface_alt: #F3F6FF
color_card: #FBFCFE

# TEXT COLORS
color_text_primary: #111827
color_text_secondary: #6B7280
color_text_tertiary: #9CA3AF
color_icon_inactive: #D1D5DB

# BORDERS
color_border: #E5E7EB
color_border_light: #F0F1F3
color_divider: #ECEEEF1

# SEMANTIC
color_error: #DC2626
color_error_light: #FEE2E2
color_success: #16A34A
color_success_light: #DCFCE7
color_warning: #F59E0B
color_warning_light: #FEF3C7
color_info: #0EA5E9
color_info_light: #CFFAFE

# TYPOGRAPHY
font_family_heading: Poppins
font_family_body: Poppins, Inter

# TEXT SIZES
text_h1: 32px, w800, -0.5px letter-spacing
text_h2: 28px, w700, -0.5px letter-spacing
text_h3: 24px, w700, -0.25px letter-spacing
text_h4: 20px, w600, 0px letter-spacing
text_h5: 18px, w600, 0px letter-spacing
text_subtitle1: 16px, w600, 0px letter-spacing
text_subtitle2: 15px, w600, 0px letter-spacing
text_body: 14px, w400, 0px letter-spacing
text_body_primary: 14px, w500, 0px letter-spacing
text_small: 13px, w500, 0px letter-spacing
text_caption: 12px, w400, 0px letter-spacing
text_btn: 16px, w600, white

# SPACING (8px base unit)
spacing_xs: 4px
spacing_sm: 8px
spacing_md: 12px
spacing_lg: 16px
spacing_xl: 24px
spacing_xxl: 32px
spacing_xxxl: 48px

# BORDERS & RADIUS
border_radius_sm: 8px
border_radius_md: 12px
border_radius_lg: 16px
border_radius_xl: 20px
border_radius_full: 999px

border_width_thin: 1px
border_width_medium: 2px

# SHADOWS (elevation system)
shadow_xs: 0 1px 2px rgba(0,0,0,0.05)
shadow_sm: 0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.08)
shadow_md: 0 4px 16px rgba(0,0,0,0.08)
shadow_lg: 0 8px 24px rgba(0,0,0,0.1)
shadow_card: shadow_sm
shadow_btn: 0 4px 16px rgba(47,107,255,0.25)
shadow_btn_hover: 0 8px 20px rgba(47,107,255,0.35)

# GRADIENTS
gradient_primary: linear-gradient(135deg, #5B8FFF, #2F6BFF)
gradient_primary_reverse: linear-gradient(135deg, #2F6BFF, #5B8FFF)

# COMPONENT SPECS
button_height_lg: 56px
button_height_md: 48px
button_height_sm: 44px
button_padding: 14px 24px
button_radius: 14px

input_height: 56px
input_padding: 14px 16px
input_radius: 12px
input_border: 1px border_color

card_padding: 16px
card_radius: 16px
card_shadow: shadow_sm

nav_bar_height: 64px
nav_icon_size: 24px
nav_label_size: 12px

# ANIMATION DURATIONS
animation_duration_quick: 200ms
animation_duration_normal: 300ms
animation_duration_slow: 500ms
animation_duration_splash: 2500ms

---

## 🎨 DRIVER/PILOT APP — Neon Dark Theme
# File: flutter_apps/driver_app/lib/config/design_tokens.dart

app_name: JAGO Pilot
app_variant: driver/pilot

# DARK PALETTE
color_bg: #060A14
color_surface: #0F1923
color_card: #162030
color_card_alt: #1A2332
color_border: #1E3050
color_border_light: #2A3F5F

# NEON ACCENTS
color_primary: #00D4FF        # neon cyan (hero)
color_primary_dark: #00A8CC   # darker cyan
color_primary_light: #E0FAFF  # light cyan
color_secondary: #00E676      # neon green
color_tertiary: #FFB300       # gold
color_error: #FF3D57          # neon red
color_warning: #FFA500        # neon orange
color_success: #00E676        # neon green

# TEXT COLORS
color_text_primary: #FFFFFF
color_text_secondary: #8899BB
color_text_tertiary: #556677
color_text_hint: #445577
color_text_inverse: #0F1923

# TYPOGRAPHY
font_family_heading: Poppins
font_family_body: Poppins, Inter

# TEXT SIZES
text_h1: 32px, w800, -0.5px letter-spacing
text_h2: 28px, w700, -0.5px letter-spacing
text_h3: 24px, w700, -0.25px letter-spacing
text_h4: 20px, w600, 0px letter-spacing
text_h5: 18px, w600, 0px letter-spacing
text_subtitle1: 16px, w600, 0px letter-spacing
text_subtitle2: 15px, w600, 0px letter-spacing
text_body: 14px, w400, 0px letter-spacing
text_body_primary: 14px, w500, 0px letter-spacing
text_small: 13px, w500, 0px letter-spacing
text_caption: 12px, w400, 0px letter-spacing
text_btn: 16px, w600, #FFFFFF

# SPACING (8px base unit)
spacing_xs: 4px
spacing_sm: 8px
spacing_md: 12px
spacing_lg: 16px
spacing_xl: 24px
spacing_xxl: 32px
spacing_xxxl: 48px

# BORDERS & RADIUS
border_radius_sm: 8px
border_radius_md: 12px
border_radius_lg: 16px
border_radius_xl: 20px
border_radius_full: 999px

border_width_thin: 1px
border_width_medium: 2px

# SHADOWS & GLOWS (neon aesthetic)
shadow_xs: 0 1px 2px rgba(0,0,0,0.3)
shadow_sm: 0 2px 8px rgba(0,0,0,0.4)
shadow_md: 0 4px 16px rgba(0,0,0,0.5)
shadow_lg: 0 8px 24px rgba(0,0,0,0.6)
glow_primary: 0 0 16px rgba(0,212,255,0.4)
glow_primary_hover: 0 0 24px rgba(0,212,255,0.6)
glow_success: 0 0 16px rgba(0,230,118,0.3)
glow_warning: 0 0 16px rgba(255,165,0,0.3)

# GRADIENTS (neon)
gradient_primary: linear-gradient(135deg, #00D4FF, #00A8CC)
gradient_primary_reverse: linear-gradient(135deg, #00A8CC, #00D4FF)
gradient_success: linear-gradient(135deg, #00E676, #00C853)
gradient_warning: linear-gradient(135deg, #FFB300, #FF6F00)

# COMPONENT SPECS
button_height_lg: 56px
button_height_md: 48px
button_height_sm: 44px
button_padding: 14px 24px
button_radius: 14px

input_height: 56px
input_padding: 14px 16px
input_radius: 12px
input_border: 1px border_color

card_padding: 16px
card_radius: 16px
card_shadow: shadow_sm

nav_bar_height: 64px
nav_icon_size: 24px
nav_label_size: 12px

# ANIMATION DURATIONS
animation_duration_quick: 200ms
animation_duration_normal: 300ms
animation_duration_slow: 500ms
animation_duration_splash: 2500ms

---

## 📐 SHARED SPECIFICATIONS (All Apps)

### Button Styles

#### Primary Action Button (56px)
- Height: 56px
- Padding: 14px 24px
- Border radius: 14px
- Font: 16px w600
- Use for: Book Ride, Accept Ride, Confirm actions
- Style: Filled with primary color
- Shadow: shadow_btn
- Hover: shadow_btn_hover

#### Secondary Button (48px)
- Height: 48px
- Padding: 12px 20px
- Border radius: 12px
- Font: 15px w600
- Use for: Cancel, View Details, Secondary actions
- Style: Outline with border
- No shadow

#### Tertiary Button (44px)
- Height: 44px
- Padding: 11px 16px
- Border radius: 12px
- Font: 14px w500
- Use for: Skip, More options, Tertiary
- Style: Ghost (transparent)
- No shadow

### Form Input Specs

- Height: 56px
- Padding: 14px 16px
- Border radius: 12px
- Border: 1px solid color_border (idle)
- Border: 2px solid color_primary (focused)
- Label size: 12px
- Hint color: color_text_tertiary
- Cursor color: color_primary

### Card Specifications

- Padding: 16px
- Border radius: 16px
- Border: 1px color_border
- Background: color_card
- Shadow: shadow_sm

### Navigation Bar

- Height: 64px (including safe area)
- Icon size: 24px
- Label: 12px w500
- Active color: color_primary
- Inactive color: color_icon_inactive (customer) / color_text_tertiary (driver)

### Spacing Rules (8px Grid)

All margins and paddings must be multiples of 4px:
- 4px, 8px, 12px, 16px, 24px, 32px, 48px

No odd numbers (15, 17, 18, 22, 25, etc.)

---

## ✅ QUALITY CHECKLIST

- [ ] All buttons have correct heights (56px, 48px, 44px)
- [ ] All inputs are 56px height
- [ ] All padding/margins use 4px grid
- [ ] All text uses defined font sizes
- [ ] All colors from palette only
- [ ] All shadows use defined system
- [ ] All radius use standard values (8, 12, 16, 20px)
- [ ] Touch targets minimum 44x44px
- [ ] Contrast ratios WCAG AA (4.5:1 minimum)
- [ ] Icons sized correctly (24px, 32px, 48px)

---

**Design Tokens Version:** 3.1  
**Last Updated:** March 24, 2026  
**Standard:** Senior Level Design System  
**Status:** ✅ PRODUCTION READY
