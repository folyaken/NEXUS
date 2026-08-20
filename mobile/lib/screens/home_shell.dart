import 'package:flutter/material.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import '../widgets/animated_background.dart';
import '../widgets/liquid_nav_bar.dart';
import 'dashboard_screen.dart';
import 'modules_screen.dart';
import 'settings_screen.dart';
import 'subscriptions_screen.dart';

/// Каркас: живой фон + экраны с плавным переходом + анимированная навигация.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  static const _pages = [
    DashboardScreen(),
    ModulesScreen(),
    SubscriptionsView(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);

    final items = [
      LiquidNavItem(
        icon: Icons.space_dashboard_rounded,
        label: t.t('nav.dashboard'),
      ),
      LiquidNavItem(
        icon: Icons.widgets_rounded,
        label: t.t('nav.modules'),
        accent: AppColors.primaryPurple,
      ),
      LiquidNavItem(
        icon: Icons.rss_feed_rounded,
        label: t.t('subs.title'),
        accent: AppColors.mint,
      ),
      LiquidNavItem(
        icon: Icons.tune_rounded,
        label: t.t('nav.settings'),
        accent: AppColors.amber,
      ),
    ];

    return Scaffold(
      body: AnimatedBackground(
        child: SafeArea(
          bottom: false,
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 340),
            switchInCurve: Curves.easeOutCubic,
            switchOutCurve: Curves.easeInCubic,
            transitionBuilder: (child, animation) {
              return FadeTransition(
                opacity: animation,
                child: SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(0.015, 0.02),
                    end: Offset.zero,
                  ).animate(animation),
                  child: child,
                ),
              );
            },
            child: KeyedSubtree(
              key: ValueKey(_index),
              child: _pages[_index],
            ),
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
          child: LiquidNavBar(
            index: _index,
            items: items,
            onChanged: (i) => setState(() => _index = i),
          ),
        ),
      ),
    );
  }
}
