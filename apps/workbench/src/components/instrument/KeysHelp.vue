<script setup lang="ts">
/*
 * Legend for the computer-keyboard mapping. The actual key handling lives
 * in InstrumentView so it works whether or not this panel is visible.
 */
</script>

<template>
  <section class="panel">
    <div class="panel-title">computer keys</div>
    <div class="rows">
      <div class="krow sharps">
        <span class="pad half"></span>
        <kbd>W</kbd><kbd>E</kbd>
        <span class="pad"></span>
        <kbd>T</kbd><kbd>Y</kbd><kbd>U</kbd>
      </div>
      <div class="krow">
        <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd><kbd>G</kbd><kbd>H</kbd><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd>
      </div>
    </div>
    <ul class="legend">
      <li><span>A .. L</span> play notes, A is C, K is C an octave up, L is D</li>
      <li><span><kbd>Z</kbd> / <kbd>X</kbd></span> octave down / up</li>
      <li><span><kbd>C</kbd> / <kbd>V</kbd></span> default velocity softer / harder</li>
      <li><span><kbd>SPACE</kbd></span> sustain while held</li>
    </ul>
  </section>
</template>

<style scoped>
.rows {
  margin-bottom: 10px;
}

.krow {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}

.krow kbd {
  min-width: 22px;
  text-align: center;
  padding: 3px 0;
  background: var(--char);
  color: var(--bone);
}

.krow.sharps kbd {
  color: var(--phosphor-hot);
}

.pad {
  width: 26px;
}

.pad.half {
  width: 13px;
}

.legend {
  list-style: none;
  font-size: 10px;
  color: var(--tick);
  letter-spacing: 0.05em;
}

.legend li {
  display: flex;
  gap: 10px;
  margin-bottom: 4px;
  align-items: baseline;
}

.legend li span {
  min-width: 74px;
  color: var(--faded);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-size: 9px;
}
</style>
