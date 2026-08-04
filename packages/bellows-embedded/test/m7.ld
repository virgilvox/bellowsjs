MEMORY {
  FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 8M
  RAM  (rwx) : ORIGIN = 0x20000000, LENGTH = 1M
}
ENTRY(main)
SECTIONS {
  .text : { *(.text*) *(.rodata*) } > FLASH
  .data : { *(.data*) } > RAM AT> FLASH
  .bss  : { *(.bss*) *(COMMON) } > RAM
  /DISCARD/ : { *(.ARM.exidx*) *(.comment) }
}
