# Daisy Seed build for 01_OneKick.
#
#   make LIBDAISY_DIR=/path/to/libDaisy
#   make LIBDAISY_DIR=/path/to/libDaisy program-dfu
#
# Point LIBDAISY_DIR at a libDaisy checkout that has been built once with
# its own `make`, so that build/libdaisy.a exists. Verified against
# libDaisy 8.1.0 (commit c02245d) with arm-none-eabi-g++ 9.2.1.

TARGET = daisy_onekick
CPP_SOURCES = main.cpp

LIBDAISY_DIR ?= ../../../../libDaisy

# libDaisy's core/Makefile sets CPP_STANDARD with ?=, so this has to be
# assigned before the include to win. It matters: the default there is
# -std=gnu++14, and every bellows header uses inline constexpr variables,
# which are C++17. GCC accepts them under gnu++14 as an extension and warns
# once per variable, so the build appears to succeed while relying on a
# GCC extension. Measured with the override removed: 16 warnings, all of
# them "inline variables are only available with -std=c++17". This is the
# Daisy twin of the -std=gnu++14 unflag the Teensy env needs.
CPP_STANDARD = -std=gnu++17

# The library, then the Teensy example's folder, because main.cpp includes
# that example's onekick.h rather than a copy of it. If the two ever drift,
# this build breaks, which is the point.
C_INCLUDES += -I../../src
C_INCLUDES += -I../01_OneKick

SYSTEM_FILES_DIR = $(LIBDAISY_DIR)/core
include $(SYSTEM_FILES_DIR)/Makefile
