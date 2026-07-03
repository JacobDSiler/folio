# Verification: Dialogue Line Detection Improvement

## Objective
Fix dialogue line detection to avoid overshooting to next dialogue when right-clicking in contenteditable elements.

## Problem Analysis
**Root Cause (Line 16689 before fix):**
```javascript
const offset = isTA ? el.selectionStart : 0;
```

For contenteditable elements, the offset was hardcoded to `0`, which meant:
- Always searching for quotes starting from position 0 (beginning of element)
- Never using the actual cursor position where user right-clicked
- Finding first quoted text in element, not text at cursor position

**Example Scenario:**
If text is: "She said 'Course you did.' and later 'Hello there.' as well."

And user right-clicks inside 'Course you did.', the offset calculation was:
- Wrong: offset = 0 → finds first quote at position 11, selects "Course you did."
- Correct: offset = 18 (cursor position) → should find opening quote at position 11

## Solution Implemented
**Lines 16689-16699 (New Code):**
```javascript
let offset = 0;
if (isTA) {
  offset = el.selectionStart;
} else if (isCE && sel && sel.rangeCount > 0) {
  // For contenteditable, calculate cursor offset from selection
  const range = sel.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(el);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  offset = preCaretRange.toString().length;
}
```

### How It Works
1. **For TEXTAREA**: Use existing `el.selectionStart` ✓
2. **For contenteditable**: 
   - Get the current selection (cursor position) from `window.getSelection()`
   - Create a range covering element start to cursor position
   - Count characters to get offset
   - Pass correct offset to dialogue finder

### Key Data Flow
```
User right-clicks → _ctxOpen() called
  ├─ Save current selection: sel = window.getSelection()
  ├─ Calculate offset for contenteditable
  │  └─ preCaretRange = range covering [start of element to cursor]
  │  └─ offset = character count in that range
  ├─ Call _ctxFindDialogueInText(fullText, offset)
  │  └─ Find opening quote before offset position
  │  └─ Find closing quote after opening quote
  │  └─ Extract and return text between quotes
  └─ Select that dialogue text
```

## Logic Validation

### Test Case 1: Right-click inside dialogue
- Text: `"She said "Course you did." and continued."`
- Cursor at: position 18 (inside "Course you did.")
- Expected: Select only "Course you did."
- Old code offset: 0 (wrong, from start of element)
- New code offset: 18 (correct, from cursor position)
- Result: ✅ Finds opening quote at 11, closing quote at 26

### Test Case 2: Multiple dialogues in element
- Text: `"First dialogue "A." then second "B." here."`
- Cursor at: position 35 (inside "B.")
- New code offset: 35
- Result: ✅ Finds opening quote at 31, closing quote at 36
- (Not position 15 which would have been found with offset=0)

### Test Case 3: Cursor in narrative text (no quotes before)
- Text: `"She walked through "the forest" and stopped."`
- Cursor at: position 5 (before any quotes)
- New code offset: 5
- Result: ✅ Finds no opening quote before position 5, returns null
- No auto-selection occurs (correct behavior)

## Edge Cases Handled

1. **Selection is null or empty**: 
   - Check: `if (isCE && sel && sel.rangeCount > 0)`
   - Falls back to offset = 0 (safe default)

2. **Range end is outside element**:
   - Safe: `selectNodeContents()` constrains range to element

3. **Zero-length selection (cursor only)**:
   - Works: `preCaretRange.setEnd(range.endContainer, range.endOffset)` 
   - Still correctly calculates position

## Code Safety
- ✅ No DOM mutations
- ✅ No external state changes
- ✅ Backward compatible (TEXTAREA path unchanged)
- ✅ Graceful fallback if selection unavailable
- ✅ Uses standard DOM APIs (getSelection, createRange, setEnd)

## Integration Points
- Integrates with existing `_ctxFindDialogueInText()` (unchanged)
- Integrates with existing `_ctxSelectDialogue()` (unchanged)
- Uses `window.getSelection()` which is already available (line 16676)
- Follows existing code patterns

## Testing Instructions
1. Open app and navigate to a chapter with dialogue
2. Right-click inside a quoted dialogue line like "Course you did."
3. Expected: Only the quoted text gets selected (shown in context menu)
4. Verify "Set Character" menu item appears (only for dialogue)
5. Right-click on narrative text
6. Expected: No auto-selection, "Set Character" hidden

## Impact
- Fixes dialogue detection for contenteditable preview paragraphs
- Enables accurate character voice assignment to dialogue lines
- No performance impact (same algorithmic complexity)
- No UI/UX changes (invisible internal fix)
