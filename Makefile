# Voorraadkast - draait volledig in de browser, geen installatie nodig.
# `make run` opent de app in je standaardbrowser.

.PHONY: run help

ifeq ($(OS),Windows_NT)
  OPEN = cmd /c start ""
else
  UNAME := $(shell uname -s)
  ifeq ($(UNAME),Darwin)
    OPEN = open
  else
    OPEN = xdg-open
  endif
endif

run:
	$(OPEN) index.html

help:
	@echo "make run   - open de app in je browser"
