#include <juce_core/juce_core.h>

/** Runs Breakseq's tests; fails when any does. */
int main()
{
    juce::UnitTestRunner runner;
    runner.runTestsInCategory ("Breakseq");

    for (int i = 0; i < runner.getNumResults(); ++i)
        if (runner.getResult (i)->failures > 0)
            return 1;

    return 0;
}
