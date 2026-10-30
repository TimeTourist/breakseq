#include <juce_core/juce_core.h>

#include <iostream>

/** Runs Breakseq's tests; fails when any does, each failure an Actions annotation (the log needs a login). */
int main()
{
    juce::UnitTestRunner runner;
    runner.runTestsInCategory ("Breakseq");

    auto failed = false;

    for (int i = 0; i < runner.getNumResults(); ++i)
    {
        const auto* result = runner.getResult (i);

        if (result->failures == 0)
            continue;

        failed = true;

        for (const auto& message : result->messages)
            std::cout << "::error::" << result->unitTestName << " / " << result->subcategoryName << ": " << message.replace ("\n", " ") << std::endl;
    }

    return failed ? 1 : 0;
}
