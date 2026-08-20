import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import '../models/subscription.dart';
import '../services/subscription_manager.dart';
import '../widgets/neu_card.dart';
import '../widgets/pulse_dot.dart';
import 'add_subscription_screen.dart';

/// Список подписок: добавление, обновление, удаление.
class SubscriptionsScreen extends StatelessWidget {
  const SubscriptionsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final manager = context.watch<SubscriptionManager>();

    return Scaffold(
      appBar: AppBar(title: Text(t.t('subs.title'))),
      body: manager.subscriptions.isEmpty
          ? Center(
              child: Text(
                t.t('vpn.noProfiles'),
                style: const TextStyle(color: AppColors.textSecondary),
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: manager.subscriptions.length,
              itemBuilder: (context, i) {
                final sub = manager.subscriptions[i];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _SubscriptionCard(subscription: sub),
                );
              },
            ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: AppColors.primaryCyan,
        foregroundColor: const Color(0xFF0A0E1A),
        onPressed: () {
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => const AddSubscriptionScreen(),
            ),
          );
        },
        child: const Icon(Icons.add),
      ),
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
      radius: 18,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  subscription.title,
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
          const SizedBox(height: 8),
          _metric(t.t('subs.traffic'), _formatBytes(subscription.totalBytes)),
          _metric(
            t.t('subs.expires'),
            subscription.expiresAt == null
                ? '∞'
                : _formatDate(subscription.expiresAt!),
          ),
          _metric(t.t('subs.interval'), '${subscription.updateHours} ${t.t('common.hours')}'),
          const SizedBox(height: 8),
          Row(
            children: [
              TextButton.icon(
                onPressed: () => manager.refresh(subscription.id),
                icon: const Icon(Icons.refresh, size: 18),
                label: Text(t.t('subs.refresh')),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primaryCyan,
                ),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: () => manager.remove(subscription.id),
                icon: const Icon(Icons.delete_outline, size: 18),
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
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(label,
                style: const TextStyle(
                    fontSize: 11, color: AppColors.textMuted)),
            Text(value,
                style: const TextStyle(
                    fontSize: 12, color: AppColors.textPrimary)),
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
