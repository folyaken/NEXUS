import 'package:flutter/material.dart';

/// Палитра NEXUS Mobile (неоновые акценты + неоморфная тёмная тема).
class AppColors {
  AppColors._();

  static const Color primaryCyan = Color(0xFF00D4AA);
  static const Color primaryPurple = Color(0xFF6C63FF);
  static const Color backgroundDark = Color(0xFF0A0E1A);
  static const Color backgroundLight = Color(0xFF121828);
  static const Color cardDark = Color(0xFF151C2A);
  static const Color cardLight = Color(0xFF1B2434);
  static const Color textPrimary = Color(0xFFEDF2FB);
  static const Color textSecondary = Color(0xFF8A97AC);
  static const Color textMuted = Color(0xFF5A6A82);

  static const Color mint = Color(0xFF71F4B8);
  static const Color amber = Color(0xFFF8C76C);
  static const Color red = Color(0xFFFF718F);

  /// Цвета неоморфных теней: светлая сверху-слева, тёмная снизу-справа.
  static const Color shadowLight = Color(0x1FFFFFFF);
  static const Color shadowDark = Color(0xFF05070D);

  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [primaryCyan, primaryPurple],
  );
}

/// Неоморфный стиль карточки (как в десктопном NEXUS, но мягче).
class Neu {
  Neu._();

  static List<BoxShadow> shadows({
    double depth = 6,
    double radius = 24,
    Color light = AppColors.shadowLight,
    Color dark = AppColors.shadowDark,
  }) {
    return [
      BoxShadow(
        color: light,
        offset: Offset(-depth * 0.5, -depth * 0.5),
        blurRadius: radius * 0.6,
      ),
      BoxShadow(
        color: dark,
        offset: Offset(depth, depth),
        blurRadius: radius,
      ),
    ];
  }

  static BoxDecoration card({
    Color color = AppColors.cardDark,
    double depth = 6,
    double radius = 20,
  }) {
    return BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(radius),
      boxShadow: shadows(depth: depth, radius: radius * 1.2),
      border: Border.all(color: Colors.white.withOpacity( 0.05)),
    );
  }

  /// Вдавленный (concave) фон — для переключателей и внутренних полей.
  static BoxDecoration inset({
    Color color = AppColors.backgroundDark,
    double radius = 14,
    double depth = 3,
  }) {
    return BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(radius),
      boxShadow: [
        BoxShadow(
          color: AppColors.shadowDark,
          offset: Offset(depth, depth),
          blurRadius: depth * 2,
        ),
        BoxShadow(
          color: AppColors.shadowLight,
          offset: Offset(-depth * 0.5, -depth * 0.5),
          blurRadius: depth * 2,
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
    fontFamily: 'Roboto',
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
        fontWeight: FontWeight.w700,
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
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: AppColors.cardDark,
      selectedItemColor: AppColors.primaryCyan,
      unselectedItemColor: AppColors.textMuted,
    ),
  );
}
