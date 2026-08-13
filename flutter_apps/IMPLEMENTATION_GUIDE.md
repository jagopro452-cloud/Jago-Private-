# 🎨 FLUTTER APPS — DESIGN SYSTEM IMPLEMENTATION GUIDE
## Senior Designer Standards (March 24, 2026)

---

## 📋 QUICK START FOR DEVELOPERS

### Using Design Tokens in Screens

#### Customer App (Premium Blue Theme)

```dart
import 'package:flutter/material.dart';
import 'config/jago_theme.dart';

class BookingScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,  // White background
      body: SafeArea(
        child: Column(
          children: [
            // HEADING
            Text(
              'Where to?',
              style: JT.h1,  // 32px, w800, bold
            ),
            SizedBox(height: JT.spacing.lg),  // 16px

            // FORM INPUT
            Container(
              height: 56,  // Standard input height
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: JT.card,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: JT.border),
              ),
              child: TextField(
                style: JT.body,
                decoration: InputDecoration(
                  hintText: 'Enter destination',
                  hintStyle: JT.bodyPrimary.copyWith(color: JT.textTertiary),
                  border: InputBorder.none,
                ),
              ),
            ),
            SizedBox(height: JT.spacing.xl),  // 24px

            // PRIMARY BUTTON
            ElevatedButton(
              onPressed: () => _bookRide(),
              style: ElevatedButton.styleFrom(
                backgroundColor: JT.primary,
                elevation: 0,
                fixedSize: Size(double.infinity, 56),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                shadowColor: JT.primary.withAlpha(64),
              ),
              child: Text('Book Ride', style: JT.btnText),
            ),
          ],
        ),
      ),
    );
  }
}
```

#### Driver/Pilot App (Neon Dark Theme)

```dart
import 'package:flutter/material.dart';
import 'config/app_theme.dart';

class RideAcceptScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,  // Ultra-dark #060A14
      body: SafeArea(
        child: Column(
          children: [
            // HEADING
            Text(
              'New Ride Available',
              style: AppText.h1(context),  // 32px, w800
              color: AppColors.textPrimary,
            ),
            SizedBox(height: 16),

            // CARD COMPONENT
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.card,  // #162030
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
                boxShadow: AppGlow.softSmall(),
              ),
              child: Column(
                children: [
                  Text(
                    '₹245',
                    style: AppText.h2(context),
                    color: AppColors.textPrimary,
                  ),
                  SizedBox(height: 8),
                  Text(
                    '12 km • 18 mins',
                    style: AppText.body(context),
                    color: AppColors.textSecondary,
                  ),
                ],
              ),
            ),
            SizedBox(height: 24),

            // NEON GRADIENT BUTTON
            Container(
              width: double.infinity,
              height: 56,
              decoration: BoxDecoration(
                gradient: AppColors.neonGrad,
                borderRadius: BorderRadius.circular(14),
                boxShadow: AppGlow.neon(AppColors.primary),
              ),
              child: ElevatedButton(
                onPressed: () => _acceptRide(),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.transparent,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
                child: Text(
                  'Accept Ride',
                  style: AppText.btnText(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

---

## 🎯 COMMON PATTERNS

### Pattern 1: Card with Icon & Text

```dart
// Customer App
Container(
  padding: EdgeInsets.all(JT.spacing.lg),  // 16px
  decoration: BoxDecoration(
    color: JT.card,
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: JT.border),
    boxShadow: JT.cardShadow,
  ),
  child: Row(
    children: [
      Icon(Icons.location_on, color: JT.primary),
      SizedBox(width: JT.spacing.md),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Pickup Location', style: JT.subtitle2),
            SizedBox(height: 4),
            Text('Hitech City', style: JT.body),
          ],
        ),
      ),
    ],
  ),
)

// Driver App
Container(
  padding: EdgeInsets.all(16),
  decoration: BoxDecoration(
    color: AppColors.card,
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: AppColors.border),
    boxShadow: AppGlow.softSmall(),
  ),
  child: Row(
    children: [
      Icon(Icons.navigation, color: AppColors.primary),
      SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Destination', style: AppText.subtitle2(null)),
            SizedBox(height: 4),
            Text('Gachibowli', style: AppText.body(null)),
          ],
        ),
      ),
    ],
  ),
)
```

### Pattern 2: Status Badge

```dart
// Customer App
Chip(
  label: Text('Active', style: JT.caption.copyWith(color: JT.textPrimary)),
  backgroundColor: JT.successLight,  // #DCFCE7
  side: BorderSide(color: JT.success, width: 1),
  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
)

// Driver App
Container(
  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
  decoration: BoxDecoration(
    color: AppColors.successLight,
    borderRadius: BorderRadius.circular(999),
    border: Border.all(color: AppColors.success),
  ),
  child: Text(
    'Available',
    style: AppText.caption(null).copyWith(
      color: AppColors.success,
      fontWeight: FontWeight.w600,
    ),
  ),
)
```

### Pattern 3: Loading States

```dart
// Customer App
Center(
  child: Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      SizedBox(
        width: 48,
        height: 48,
        child: CircularProgressIndicator(
          valueColor: AlwaysStoppedAnimation(JT.primary),
          strokeWidth: 3,
        ),
      ),
      SizedBox(height: JT.spacing.lg),
      Text('Finding rides nearby...', style: JT.body),
    ],
  ),
)

// Driver App
Center(
  child: Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      SizedBox(
        width: 48,
        height: 48,
        child: CircularProgressIndicator(
          valueColor: AlwaysStoppedAnimation(AppColors.primary),
          strokeWidth: 3,
        ),
      ),
      SizedBox(height: 16),
      Text('Accepting ride...', style: AppText.body(null)),
    ],
  ),
)
```

---

## ❌ ANTI-PATTERNS (NEVER DO THIS)

### ❌ Wrong Button Heights
```dart
// BAD
ElevatedButton(
  child: Text('Book'),
  onPressed: onTap,
  // Missing height = shrinks to text size (looks wrong)
)

// GOOD
ElevatedButton(
  onPressed: onTap,
  style: ElevatedButton.styleFrom(
    fixedSize: Size(double.infinity, 56),  // 56px standard
  ),
  child: Text('Book'),
)
```

### ❌ Wrong Spacing
```dart
// BAD
SizedBox(height: 15)   // Not on grid
SizedBox(height: 22)   // Not on grid
SizedBox(height: 30)   // Not on grid

// GOOD
SizedBox(height: 16)   // spacing_lg (4px grid)
SizedBox(height: 24)   // spacing_xl (4px grid)
SizedBox(height: 32)   // spacing_xxl (4px grid)
```

### ❌ Custom Colors (Outside Palette)
```dart
// BAD
Color(0xFF3A7BFF)     // Custom blue (looks off)
Color(0xFF00E0FF)     // Random cyan (inconsistent)

// GOOD
JT.primary            // #2F6BFF (customer, consistent)
AppColors.primary     // #00D4FF (driver, consistent)
```

### ❌ Uneven Padding
```dart
// BAD
padding: EdgeInsets.only(left: 15, right: 17)  // Asymmetric, odd numbers
padding: EdgeInsets.all(13)                      // Odd number

// GOOD
padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14)  // 4px grid
padding: EdgeInsets.all(16)                                   // 4px grid
```

### ❌ Inconsistent Text Styles
```dart
// BAD
Text(
  'Pickup Location',
  style: TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w600,
    color: Color(0xFF111827),
  ),
)

// GOOD
Text(
  'Pickup Location',
  style: JT.subtitle2,  // Pre-defined size, weight, color
)
```

---

## 🧪 TESTING CHECKLIST

Before submitting any screen:

- [ ] All buttons are correct height (56px primary, 48px secondary, 44px tertiary)
- [ ] All inputs are 56px tall
- [ ] All spacing measured: no value like 15, 18, 22, 25, etc. (only 4px multiples)
- [ ] All colors from JT/AppColors only (no hardcoded colors)
- [ ] All text uses predefined styles (JT.h1, AppText.body, etc.)
- [ ] All cards have shadows from system (JT.cardShadow, AppGlow.*)
- [ ] All border radius is standard (8, 12, 16, 20px)
- [ ] Icons are correctly sized (24px standard, 48px hero)
- [ ] No hardcoded padding/margin exceptions
- [ ] Touch targets minimum 44x44px (accessibility)

---

## 📚 REFERENCE FILES

**Customer App (Premium Blue):**
- `lib/config/jago_theme.dart` - Color system
- `lib/config/app_theme.dart` - Text styles

**Driver App (Neon Dark):**
- `lib/config/app_theme.dart` - Complete system
- `lib/config/jago_theme.dart` - Backward compatibility

**Shared:**
- `DESIGN_SYSTEM_V3.md` - Full documentation
- `DESIGN_TOKENS.md` - Token specifications

---

## 🚀 DEPLOYMENT NOTES

**Before APK Build:**
1. Run `flutter analyze` to check for lint errors
2. Check all screens against checklist above
3. Test light theme toggle (customer app)
4. Test dark theme (driver/pilot apps)
5. Check button states (normal, hover, disabled, loading)

**Release Notes:**
- Design System v3.1 applied
- All screens standardized to senior-level specs
- WCAG AA accessibility compliance verified

---

**Version:** 3.1  
**Last Updated:** March 24, 2026  
**Audience:** Flutter Developers  
**Status:** ✅ READY FOR IMPLEMENTATION
