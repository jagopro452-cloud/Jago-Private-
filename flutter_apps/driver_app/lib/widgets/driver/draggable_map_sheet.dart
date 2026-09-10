import 'package:flutter/material.dart';

/// Shared "map background + bottom sheet + floating controls" scaffolding
/// used by both `TripScreen` and `LocalPoolScreen`.
///
/// Renders a `Stack` with, in paint order: an optional full-bleed [map]
/// layer, an optional [floatingControls] cluster anchored above the sheet,
/// and a white rounded-top sheet pinned to the bottom of the available
/// space. The sheet's height is either:
///  - fixed/draggable, via [heightFraction] (a fraction of the screen
///    height, applied as both min and max height) together with [handle] +
///    [onHandleDragUpdate] — TripScreen's mode, or
///  - content-sized up to [maxHeight] — LocalPoolScreen's mode.
///
/// [map] is nullable: a caller whose map must never change tree position
/// (e.g. to avoid remounting a `GoogleMap` platform view when this widget's
/// *other* content swaps out for a differently-shaped overlay elsewhere in
/// the same screen) can keep rendering its map as a separate, stable
/// sibling behind this widget and simply omit it here.
///
/// [handle], when provided, is rendered in its own row above the (scrollable)
/// [sheetBody] — matching `TripScreen`'s draggable-handle-above-content
/// layout. When omitted, [sheetBody] is rendered directly as the sheet's
/// sole child, so a caller that wants its handle to just be the first item
/// of its own scrollable content (`LocalPoolScreen`'s non-interactive
/// handle) can do so by including it in [sheetBody] itself.
class DraggableMapSheet extends StatelessWidget {
  final Widget? map;

  final Widget? floatingControls;
  final double floatingControlsRight;
  final double floatingControlsBottom;

  final Widget sheetBody;
  final Widget? handle;
  final GestureDragUpdateCallback? onHandleDragUpdate;
  final double handleRowHeight;

  /// Fraction of the screen height applied as both min and max sheet
  /// height (fixed/draggable mode). Mutually exclusive with [maxHeight] in
  /// practice, though nothing enforces that.
  final double? heightFraction;

  /// Max sheet height in logical pixels, with the sheet otherwise sized to
  /// its content (content-sized mode).
  final double? maxHeight;

  final double sheetRadius;
  final Color sheetColor;
  final List<BoxShadow>? sheetShadow;

  final EdgeInsetsGeometry bodyPadding;
  final bool wrapBodyInSafeArea;
  final bool wrapBodyInScrollView;
  final ScrollPhysics? bodyScrollPhysics;

  const DraggableMapSheet({
    super.key,
    this.map,
    this.floatingControls,
    this.floatingControlsRight = 16,
    this.floatingControlsBottom = 16,
    required this.sheetBody,
    this.handle,
    this.onHandleDragUpdate,
    this.handleRowHeight = 28,
    this.heightFraction,
    this.maxHeight,
    this.sheetRadius = 28,
    this.sheetColor = Colors.white,
    this.sheetShadow,
    this.bodyPadding = const EdgeInsets.fromLTRB(20, 0, 20, 28),
    this.wrapBodyInSafeArea = true,
    this.wrapBodyInScrollView = true,
    this.bodyScrollPhysics = const ClampingScrollPhysics(),
  });

  @override
  Widget build(BuildContext context) {
    BoxConstraints? constraints;
    final frac = heightFraction;
    final maxH = maxHeight;
    if (frac != null) {
      final h = MediaQuery.of(context).size.height * frac;
      constraints = BoxConstraints(minHeight: h, maxHeight: h);
    } else if (maxH != null) {
      constraints = BoxConstraints(maxHeight: maxH);
    }

    Widget body = sheetBody;
    if (wrapBodyInScrollView) {
      body = SingleChildScrollView(
        physics: bodyScrollPhysics,
        padding: bodyPadding,
        child: body,
      );
    }
    if (wrapBodyInSafeArea) {
      body = SafeArea(top: false, child: body);
    }

    Widget sheetChild;
    final handleWidget = handle;
    if (handleWidget != null) {
      Widget handleRow = Container(
        width: double.infinity,
        height: handleRowHeight,
        alignment: Alignment.center,
        color: Colors.transparent,
        child: handleWidget,
      );
      final onDrag = onHandleDragUpdate;
      if (onDrag != null) {
        handleRow = GestureDetector(
          behavior: HitTestBehavior.opaque,
          onVerticalDragUpdate: onDrag,
          child: handleRow,
        );
      }
      sheetChild = Column(
        mainAxisSize: MainAxisSize.min,
        children: [handleRow, Flexible(child: body)],
      );
    } else {
      sheetChild = body;
    }

    final mapWidget = map;
    final controls = floatingControls;

    return Stack(children: [
      if (mapWidget != null) Positioned.fill(child: mapWidget),
      if (controls != null)
        Positioned(
          right: floatingControlsRight,
          bottom: floatingControlsBottom,
          child: controls,
        ),
      Positioned(
        bottom: 0,
        left: 0,
        right: 0,
        child: Container(
          constraints: constraints,
          decoration: BoxDecoration(
            color: sheetColor,
            borderRadius: BorderRadius.vertical(top: Radius.circular(sheetRadius)),
            boxShadow: sheetShadow,
          ),
          child: sheetChild,
        ),
      ),
    ]);
  }
}
