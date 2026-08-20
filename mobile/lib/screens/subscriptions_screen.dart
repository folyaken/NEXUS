import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import '../models/subscription.dart';
import '../services/subscription_manager.dart';
import '../widgets/neu_card.dart';
import '../widgets/pulse_dot.dart';
import 'add_subscription_screen.dart';

/// Список подписок как вкладка (без собственного Scaffold).
class SubscriptionsView extends StatelessWidget {
  const SubscriptionsView({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final manager = context.watch<SubscriptionManager>();

    return ListView(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 24),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                t.t('subs.title'),
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            IconButton(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AddSubscriptionScreen()),
              ),
              icon: const Icon(Icons.add_circle_rounded,
                  size: 26, color: AppColors.primaryCyan),
            ),
          ],
        ).animate().fadeIn(duration: 350.ms),
        const SizedBox(height: 10),
        if (manager.subscriptions.isEmpty)
          NeuCard(
            radius: 20,
            child: Column(
              children: [
                const Icon(Icons.rss_feed_rounded,
                    size: 40, color: AppColors.textMuted),
                const SizedBox(height: 10),
                Text(
                  t.t('vpn.noProfiles'),
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                    color: AppColors.textPrimary,
                  ),
                ),
              ],
            ),
          )
        else
          ...List.generate(manager.subscriptions.length, (i) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _SubscriptionCard(subscription: manager.subscriptions[i]),
            ).animate().fadeIn(
                  duration: 400.ms,
                  delay: Duration(milliseconds: 80 + i * 70),
                ).slideY(begin: 0.06, end: 0);
          }),
      ],
    );
  }
}

/// Полноэкранная версия (для навигации push).
class SubscriptionsScreen extends StatelessWidget {
  const SubscriptionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(AppLocalizations.of(context).t('subs.title'))),
      body: const SubscriptionsView(),
    );
  }
}

class _SubscriptionCard extends StatelessWidget {
  const _SubscriptionCard({required this.subscription});

  final Subscription subscription;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final manager = context.read<SubscriptionManager>();

    return NeuCard(
      radius: 20,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  subscription.title,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              const PulseDot(size: 7),
              const SizedBox(width: 6),
              Text(
                '${subscription.serverCount} ${t.t('vpn.servers')}',
                style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _metric(t.t('subs.traffic'), _formatBytes(subscription.totalBytes)),
          _metric(
            t.t('subs.expires'),
            subscription.expiresAt == null
                ? '∞'
                : _formatDate(subscription.expiresAt!),
          ),
          _metric(
            t.t('subs.interval'),
            '${subscription.updateHours} ${t.t('common.hours')}',
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              TextButton.icon(
                onPressed: () => manager.refresh(subscription.id),
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: Text(t.t('subs.refresh')),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primaryCyan,
                ),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: () => manager.remove(subscription.id),
                icon: const Icon(Icons.delete_outline_rounded, size: 18),
                label: Text(t.t('subs.remove')),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.red,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metric(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label,
                style: const TextStyle(
                    fontSize: 11, color: AppColors.textMuted)),
            Text(value,
                style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary)),
          ],
        ),
      );

  String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / 1024 / 1024).toStringAsFixed(1)} MB';
    }
    return '${(bytes / 1024 / 1024 / 1024).toStringAsFixed(2)} GB';
  }

  String _formatDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
}
