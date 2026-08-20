import 'package:flutter/material.dart';

/// Палитра NEXUS Mobile — глубокая тёмная база + неоновые акценты.
class AppColors {
  AppColors._();

  static const Color primaryCyan = Color(0xFF00D4AA);
  static const Color primaryPurple = Color(0xFF6C63FF);
  static const Color backgroundDark = Color(0xFF05070E);
  static const Color backgroundLight = Color(0xFF0D1420);
  static const Color cardDark = Color(0xFF111827);
  static const Color cardLight = Color(0xFF1B2536);
  static const Color textPrimary = Color(0xFFEDF2FB);
  static const Color textSecondary = Color(0xFF8A97AC);
  static const Color textMuted = Color(0xFF5A6A82);

  static const Color mint = Color(0xFF71F4B8);
  static const Color amber = Color(0xFFF8C76C);
  static const Color red = Color(0xFFFF718F);

  /// Цвета нижней навигации.
  static const Color navBackground = Color(0xFF0A0E1A);
  static const Color navInactive = Color(0xFF8A94A6);

  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [primaryCyan, primaryPurple],
  );

  static const LinearGradient brandSoft = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0x2600D4AA), Color(0x266C63FF)],
  );

  /// Цвет протокола VPN.
  static Color protocolColor(String protocol) => switch (protocol) {
        'vless' => primaryCyan,
        'vmess' => primaryPurple,
        'trojan' => amber,
        'shadowsocks' => mint,
        'hysteria2' => const Color(0xFFB28CFF),
        _ => primaryCyan,
      };
}

/// Неоморфные тени и вдавленные поля.
class Neu {
  Neu._();

  /// Двойная неоморфная тень: тёмная снизу + светлая сверху-слева.
  static List<BoxShadow> shadows({
    double depth = 12,
    double radius = 26,
  }) {
    return [
      BoxShadow(
        color: Colors.black.withOpacity(0.6),
        offset: Offset(0, depth),
        blurRadius: radius,
      ),
      BoxShadow(
        color: Colors.white.withOpacity(0.06),
        offset: Offset(-depth * 0.35, -depth * 0.35),
        blurRadius: radius * 0.5,
      ),
    ];
  }

  /// Вдавленный (concave) фон для внутренних полей.
  static BoxDecoration inset({
    Color color = AppColors.backgroundDark,
    double radius = 14,
  }) {
    return BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: Colors.white.withOpacity(0.06)),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withOpacity(0.5),
          offset: const Offset(0, 3),
          blurRadius: 8,
        ),
        BoxShadow(
          color: Colors.white.withOpacity(0.04),
          offset: const Offset(-2, -2),
          blurRadius: 4,
        ),
      ],
    );
  }
}

ThemeData buildNexusTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: AppColors.backgroundDark,
  );

  return base.copyWith(
    colorScheme: const ColorScheme.dark(
      primary: AppColors.primaryCyan,
      secondary: AppColors.primaryPurple,
      surface: AppColors.cardDark,
      error: AppColors.red,
    ),
    textTheme: const TextTheme(
      headlineMedium: TextStyle(
        color: AppColors.textPrimary,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.5,
      ),
      titleLarge: TextStyle(
        color: AppColors.textPrimary,
        fontWeight: FontWeight.w700,
      ),
      bodyLarge: TextStyle(color: AppColors.textPrimary),
      bodyMedium: TextStyle(color: AppColors.textSecondary),
      labelMedium: TextStyle(color: AppColors.textSecondary),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      foregroundColor: AppColors.textPrimary,
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.cardLight,
      contentTextStyle: const TextStyle(color: AppColors.textPrimary),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    splashFactory: InkRipple.splashFactory,
    highlightColor: AppColors.primaryCyan.withOpacity(0.08),
  );
}
