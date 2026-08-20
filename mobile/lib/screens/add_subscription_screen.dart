import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/l10n.dart';
import '../core/theme.dart';
import '../services/subscription_manager.dart';
import '../widgets/neu_card.dart';

/// Добавление подписки по HTTPS-ссылке.
class AddSubscriptionScreen extends StatefulWidget {
  const AddSubscriptionScreen({super.key});

  @override
  State<AddSubscriptionScreen> createState() => _AddSubscriptionScreenState();
}

class _AddSubscriptionScreenState extends State<AddSubscriptionScreen> {
  final _url = TextEditingController();
  final _name = TextEditingController();
  int _interval = 12;
  bool _busy = false;

  @override
  void dispose() {
    _url.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final url = _url.text.trim();
    if (url.isEmpty) return;
    setState(() => _busy = true);
    try {
      await context.read<SubscriptionManager>().add(
            url,
            title: _name.text.trim().isEmpty ? null : _name.text.trim(),
          );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);

    return Scaffold(
      appBar: AppBar(title: Text(t.t('subs.add'))),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          NeuCard(
            inset: true,
            radius: 16,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: TextField(
              controller: _url,
              keyboardType: TextInputType.url,
              decoration: InputDecoration(
                hintText: t.t('subs.urlHint'),
                border: InputBorder.none,
              ),
            ),
          ),
          const SizedBox(height: 12),
          NeuCard(
            inset: true,
            radius: 16,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            child: TextField(
              controller: _name,
              decoration: InputDecoration(
                hintText: t.t('subs.name'),
                border: InputBorder.none,
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            '${t.t('subs.interval')}: $_interval ${t.t('common.hours')}',
            style: const TextStyle(color: AppColors.textSecondary),
          ),
          Slider(
            value: _interval.toDouble(),
            min: 1,
            max: 24,
            divisions: 23,
            label: '$_interval',
            activeColor: AppColors.primaryCyan,
            onChanged: (v) => setState(() => _interval = v.round()),
          ),
          const SizedBox(height: 18),
          SizedBox(
            height: 52,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: AppColors.brandGradient,
              ),
              child: TextButton(
                onPressed: _busy ? null : _save,
                child: _busy
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Color(0xFF0A0E1A),
                        ),
                      )
                    : Text(
                        t.t('common.save'),
                        style: const TextStyle(
                          color: Color(0xFF0A0E1A),
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
