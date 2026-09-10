import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Bottom sheet listing every passenger in the active Local Pool session,
/// each numbered by pickup/drop order — replaces the old always-visible
/// "Pickup & Drop Order" card and full scrolling passenger-card list.
///
/// [items] are pre-built by the screen (the existing per-passenger card
/// widget, unchanged) so this sheet stays purely presentational chrome
/// around content the screen already knows how to render.
class PoolStopsSheet extends StatelessWidget {
  final List<Widget> items;

  const PoolStopsSheet({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      expand: false,
      builder: (context, scrollController) {
        return SafeArea(
          top: false,
          child: Column(
            children: [
              const SizedBox(height: 12),
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(color: JT.border, borderRadius: BorderRadius.circular(4)),
              ),
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Row(
                  children: [
                    Text(
                      'Upcoming Stops (${items.length})',
                      style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600, color: JT.textPrimary),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: items.isEmpty
                    ? Center(
                        child: Text(
                          'No passengers in this pool session yet.',
                          style: GoogleFonts.poppins(fontSize: 12.5, color: JT.textSecondary),
                        ),
                      )
                    : ListView.builder(
                        controller: scrollController,
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                        itemCount: items.length,
                        itemBuilder: (context, index) => Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Container(
                                    width: 22,
                                    height: 22,
                                    decoration: BoxDecoration(
                                      color: JT.primary.withValues(alpha: 0.10),
                                      borderRadius: BorderRadius.circular(11),
                                    ),
                                    child: Center(
                                      child: Text(
                                        '${index + 1}',
                                        style: GoogleFonts.poppins(fontSize: 11, fontWeight: FontWeight.w700, color: JT.primary),
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Stop ${index + 1}',
                                    style: GoogleFonts.poppins(fontSize: 11.5, fontWeight: FontWeight.w600, color: JT.textSecondary),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              items[index],
                            ],
                          ),
                        ),
                      ),
              ),
            ],
          ),
        );
      },
    );
  }
}
